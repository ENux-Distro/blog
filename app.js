/* Emir's Blog — single-page app. Routes (hash based, works on GitHub Pages):
 *   #/            feed (latest posts, infinite scroll)
 *   #/post/:id    one post + comments
 *   #/new         write a post
 *   #/login  #/signup  #/tos
 */
(() => {
  "use strict";

  const PAGE_SIZE = 15;
  const cfg = window.BLOG_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT-REF");
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const app = document.getElementById("app");
  const state = { session: null, profile: null };

  // ───────────── Utilities ─────────────
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer nofollow"); }
    if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
  });
  const md = (text) => DOMPurify.sanitize(marked.parse(String(text ?? ""), { gfm: true, breaks: true }));

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    const units = [[60, "m"], [24, "h"], [7, "d"]];
    let v = s / 60;
    for (const [n, u] of units) { if (v < n) return Math.floor(v) + u; v /= n; }
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  const icon = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H3V10h4zm0 0 4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h4v11h-4zm0 0-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.9 3H17"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2m1 0-1 14H8L7 6"/></svg>',
  };

  const loggedIn = () => !!state.session;
  const isAdmin = () => !!state.profile?.is_admin;
  const myId = () => state.session?.user?.id;

  function requireLogin(what) {
    if (loggedIn()) return true;
    toast(`Create an account or log in to ${what}.`);
    return false;
  }

  function friendlyError(err) {
    const m = err?.message || String(err);
    if (/Invalid login credentials/i.test(m)) return "Wrong email or password.";
    if (/already registered/i.test(m)) return "An account with this email already exists.";
    if (/Password should be/i.test(m)) return m;
    return m;
  }

  // ───────────── Auth ─────────────
  async function loadProfile() {
    state.profile = null;
    if (!state.session) return;
    const { data } = await sb.from("profiles").select("id, username, is_admin").eq("id", myId()).maybeSingle();
    state.profile = data;
  }

  // ───────────── Header ─────────────
  function header() {
    const right = loggedIn()
      ? `<span class="who">@${esc(state.profile?.username || "")}</span>
         <a class="btn primary" href="#/new">New post</a>
         <button class="btn ghost" data-action="logout">Log out</button>`
      : `<a class="btn ghost" href="#/login">Log in</a>
         <a class="btn primary" href="#/signup">Sign up</a>`;
    return `<header class="topbar"><div class="topbar-inner">
      ${isAdmin() ? '<span class="admin-tag">Admin</span>' : ""}
      <a class="brand" href="#/">The Creator of ENux's Blog</a>
      <span class="spacer"></span>${right}
    </div></header>`;
  }

  function render(mainHtml) {
    app.innerHTML = header() + `<main>${mainHtml}</main>`;
    return app.querySelector("main");
  }

  // ───────────── Post rendering ─────────────
  function authorLine(p, extra = "") {
    return `<div class="meta">
      <span class="subject">${esc(p.subject)}</span>
      <span class="author">@${esc(p.author_username)}</span>
      ${p.author_is_admin ? '<span class="badge-admin">Admin</span>' : ""}
      <span>· ${esc(timeAgo(p.created_at))}</span>${extra}
    </div>`;
  }

  function actionsRow(p, { full = false } = {}) {
    const canDelete = loggedIn() && (p.author_id === myId() || isAdmin());
    const canDeleteUser = full && isAdmin() && p.author_id !== myId();
    return `<div class="actions" data-post="${p.id}">
      <button class="act ${p.my_vote === 1 ? "on" : ""}" data-action="vote" data-value="1" aria-label="Like" aria-pressed="${p.my_vote === 1}">${icon.up}<span>${p.likes}</span></button>
      <button class="act ${p.my_vote === -1 ? "on" : ""}" data-action="vote" data-value="-1" aria-label="Dislike" aria-pressed="${p.my_vote === -1}">${icon.down}<span>${p.dislikes}</span></button>
      <a class="act" href="#/post/${p.id}" aria-label="Comments">${icon.comment}<span>${p.comment_count}</span></a>
      <button class="act" data-action="share" aria-label="Share">${icon.share}<span>Share</span></button>
      ${canDelete || canDeleteUser ? '<span class="act-right"></span>' : ""}
      ${canDelete ? `<button class="act" data-action="delete-post" aria-label="Delete post">${icon.trash}</button>` : ""}
      ${canDeleteUser ? `<button class="act" data-action="delete-user" data-user="${esc(p.author_id)}" data-username="${esc(p.author_username)}">Delete user</button>` : ""}
    </div>`;
  }

  function postCard(p) {
    return `<article class="post clickable" data-href="#/post/${p.id}">
      ${authorLine(p)}
      <h2>${esc(p.title)}</h2>
      <div class="md preview-clip">${md(p.body)}</div>
      ${actionsRow(p)}
    </article>`;
  }

  function markClipped(root) {
    root.querySelectorAll(".preview-clip").forEach((el) => {
      const check = () => el.classList.toggle("clipped", el.scrollHeight > el.clientHeight + 2);
      check();
      el.querySelectorAll("img").forEach((img) => img.addEventListener("load", check, { once: true }));
    });
  }

  // Keep post data so vote/share handlers can update in place.
  const postCache = new Map();

  // ───────────── Pages ─────────────
  async function pageFeed() {
    const main = render(`<div id="feed"></div><div class="loading" id="feed-status">Loading…</div><div class="sentinel" id="sentinel"></div>`);
    const feed = main.querySelector("#feed");
    const status = main.querySelector("#feed-status");
    let offset = 0, done = false, busy = false;

    async function more() {
      if (busy || done) return;
      busy = true;
      const { data, error } = await sb.from("post_feed").select("*")
        .order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      busy = false;
      if (!feed.isConnected) return;
      if (error) { status.textContent = "Couldn't load posts: " + error.message; return; }
      data.forEach((p) => postCache.set(String(p.id), p));
      feed.insertAdjacentHTML("beforeend", data.map(postCard).join(""));
      markClipped(feed);
      offset += data.length;
      if (data.length < PAGE_SIZE) {
        done = true;
        status.textContent = offset === 0 ? "" : "You're all caught up.";
        if (offset === 0) feed.innerHTML = `<div class="empty">No posts yet.${loggedIn() ? ' <a href="#/new">Write the first one.</a>' : ""}</div>`;
      }
    }

    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) more(); }, { rootMargin: "600px" });
    io.observe(main.querySelector("#sentinel"));
    cleanup = () => io.disconnect();
    await more();
  }

  async function pagePost(id) {
    const main = render(`<div class="loading">Loading…</div>`);
    const [{ data: p, error }, { data: comments }] = await Promise.all([
      sb.from("post_feed").select("*").eq("id", id).maybeSingle(),
      sb.from("comments").select("id, body, created_at, author_id, profiles(username, is_admin)").eq("post_id", id).order("created_at"),
    ]);
    if (!main.isConnected) return;
    if (error || !p) { main.innerHTML = `<div class="empty">This post doesn't exist or was deleted. <a href="#/">Back to the feed</a></div>`; return; }
    postCache.set(String(p.id), p);
    document.title = `${p.title} · Emir's Blog`;

    const commentHtml = (c) => {
      const canDel = loggedIn() && (c.author_id === myId() || isAdmin());
      return `<div class="comment" data-comment="${c.id}">
        <div class="meta"><span class="author">@${esc(c.profiles?.username)}</span>
          ${c.profiles?.is_admin ? '<span class="badge-admin">Admin</span>' : ""}
          <span>· ${esc(timeAgo(c.created_at))}</span>
          ${canDel ? `<span class="spacer"></span><button class="act" data-action="delete-comment" aria-label="Delete comment">${icon.trash}</button>` : ""}
        </div>
        <div class="md">${md(c.body)}</div>
      </div>`;
    };

    main.innerHTML = `<article class="post">
        ${authorLine(p)}
        <h1 class="title">${esc(p.title)}</h1>
        <div class="md">${md(p.body)}</div>
        ${actionsRow(p, { full: true })}
      </article>
      <section class="post">
        <h3 style="margin:0 0 8px;font-size:15px">Comments</h3>
        ${loggedIn()
          ? `<form class="comment-form" id="comment-form">
               <textarea name="body" maxlength="5000" placeholder="Write a comment" required></textarea>
               <div class="form-error" id="comment-err"></div>
               <button class="btn primary" type="submit">Comment</button>
             </form>`
          : `<p class="muted" style="font-size:14px"><a href="#/login">Log in</a> or <a href="#/signup">sign up</a> to comment.</p>`}
        <div class="comments" id="comments">${(comments || []).map(commentHtml).join("") || '<p class="muted" style="font-size:14px">No comments yet.</p>'}</div>
      </section>`;

    const form = main.querySelector("#comment-form");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = form.body.value.trim();
      if (!body) return;
      const btn = form.querySelector("button"); btn.disabled = true;
      const { error } = await sb.from("comments").insert({ post_id: p.id, author_id: myId(), body });
      btn.disabled = false;
      if (error) { form.querySelector("#comment-err").textContent = friendlyError(error); return; }
      route();
    });
  }

  async function pageNew() {
    if (!loggedIn()) { location.hash = "#/login"; return; }
    const main = render(`<h1 class="page-title">New post</h1>
      <form class="card-form" id="post-form" novalidate>
        <div class="field"><label for="subject">Subject <span class="counter" id="subject-count">0/30</span></label>
          <input type="text" id="subject" name="subject" maxlength="30" placeholder="" required></div>
        <div class="field"><label for="title">Title</label>
          <input type="text" id="title" name="title" maxlength="300" required></div>
        <div class="field"><label>Body</label>
          <div class="tabs">
            <button type="button" class="btn on" data-tab="write">Write</button>
            <button type="button" class="btn" data-tab="preview">Preview</button>
            <span class="spacer"></span>
            <label class="btn" style="margin:0;color:var(--text);font-size:13px;padding:4px 12px">Add image
              <input type="file" id="image-input" accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>
          </div>
          <textarea id="body" name="body" maxlength="40000" placeholder="" required></textarea>
          <div class="md preview-box" id="preview" hidden></div>
          <div class="hint">Images: PNG, JPEG, GIF or WebP, up to 5 MB.</div>
        </div>
        <div class="form-error" id="post-err"></div>
        <div class="form-foot"><button class="btn primary" type="submit">Publish</button>
          <a class="btn ghost" href="#/">Cancel</a></div>
      </form>`);

    const form = main.querySelector("#post-form");
    const body = form.querySelector("#body");
    const preview = form.querySelector("#preview");
    const err = form.querySelector("#post-err");
    form.subject.addEventListener("input", () => { main.querySelector("#subject-count").textContent = `${form.subject.value.length}/30`; });

    form.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      const showPreview = b.dataset.tab === "preview";
      form.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b));
      body.hidden = showPreview; preview.hidden = !showPreview;
      if (showPreview) preview.innerHTML = md(body.value) || '<span class="muted">Nothing to preview.</span>';
    }));

    form.querySelector("#image-input").addEventListener("change", async (e) => {
      const file = e.target.files[0]; e.target.value = "";
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { err.textContent = "Image is larger than 5 MB."; return; }
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${myId()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      toast("Uploading image…");
      const { error } = await sb.storage.from("post-images").upload(path, file, { contentType: file.type });
      if (error) { err.textContent = "Upload failed: " + error.message; return; }
      const url = sb.storage.from("post-images").getPublicUrl(path).data.publicUrl;
      const snippet = `\n![${file.name.replace(/[\[\]]/g, "")}](${url})\n`;
      const at = body.selectionStart ?? body.value.length;
      body.value = body.value.slice(0, at) + snippet + body.value.slice(at);
      toast("Image added.");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const subject = form.subject.value.trim(), title = form.title.value.trim(), text = body.value.trim();
      if (!subject || !title || !text) { err.textContent = "Subject, title and body are all required."; return; }
      if (subject.length > 30) { err.textContent = "Subject can be at most 30 characters."; return; }
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
      const { data, error } = await sb.from("posts").insert({ author_id: myId(), subject, title, body: text }).select("id").single();
      btn.disabled = false;
      if (error) { err.textContent = friendlyError(error); return; }
      location.hash = `#/post/${data.id}`;
    });
  }

  function pageLogin() {
    if (loggedIn()) { location.hash = "#/"; return; }
    const main = render(`<h1 class="page-title">Log in</h1>
      <form class="card-form" id="login-form">
        <div class="field"><label for="email">Email</label><input type="email" id="email" name="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Password</label><input type="password" id="password" name="password" autocomplete="current-password" required></div>
        <div class="form-error" id="login-err"></div>
        <div class="form-foot"><button class="btn primary" type="submit">Log in</button>
          <span class="muted" style="font-size:14px">No account? <a href="#/signup">Sign up</a></span></div>
      </form>`);
    const form = main.querySelector("#login-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button"); btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
      btn.disabled = false;
      if (error) { form.querySelector("#login-err").textContent = friendlyError(error); return; }
      location.hash = "#/";
    });
  }

  function pageSignup() {
    if (loggedIn()) { location.hash = "#/"; return; }
    const main = render(`<h1 class="page-title">Create an account</h1>
      <form class="card-form" id="signup-form">
        <div class="field"><label for="username">Username</label>
          <input type="text" id="username" name="username" autocomplete="username" maxlength="20" required>
          <div class="hint">3–20 characters: letters, numbers and underscores.</div></div>
        <div class="field"><label for="email">Email</label><input type="email" id="email" name="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Password</label>
          <input type="password" id="password" name="password" autocomplete="new-password" minlength="8" required>
          <div class="hint">At least 8 characters.</div></div>
        <label class="check"><input type="checkbox" name="tos" required>
          <span>I have read and agree to the <a href="#/tos" target="_blank">Terms of Service</a>.</span></label>
        <div class="form-error" id="signup-err"></div>
        <div class="form-foot"><button class="btn primary" type="submit">Sign up</button>
          <span class="muted" style="font-size:14px">Have an account? <a href="#/login">Log in</a></span></div>
      </form>`);
    const form = main.querySelector("#signup-form");
    const err = form.querySelector("#signup-err");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      const username = form.username.value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) { err.textContent = "Username must be 3–20 letters, numbers or underscores."; return; }
      if (form.password.value.length < 8) { err.textContent = "Password must be at least 8 characters."; return; }
      if (!form.tos.checked) { err.textContent = "You need to accept the Terms of Service."; return; }
      const btn = form.querySelector("button"); btn.disabled = true;
      try {
        const { data: free, error: e1 } = await sb.rpc("username_available", { name: username });
        if (e1) throw e1;
        if (!free) throw new Error("That username is taken.");
        const { data, error } = await sb.auth.signUp({
          email: form.email.value.trim(), password: form.password.value,
          options: { data: { username, tos_accepted: true } },
        });
        if (error) throw error;
        // With "Confirm email" on, Supabase answers a duplicate email with a fake
        // user that has no identities instead of an error (anti-enumeration).
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error("An account with this email already exists.");
        }
        if (!data.session) {
          // Happens only if "Confirm email" is still on in Supabase settings.
          err.textContent = "Account created — check your email to confirm it, then log in.";
          return;
        }
        toast(`Welcome, @${username}!`);
        location.hash = "#/";
      } catch (ex) {
        err.textContent = friendlyError(ex);
      } finally { btn.disabled = false; }
    });
  }

  function pageTos() {
    document.title = "Terms of Service · Emir's Blog";
    render(`<article class="post tos">
      <h1 class="title">Terms of Service</h1>
      <p class="muted">Last updated: 18 November 2026</p>
      <p>These terms apply to the blog at extras.emirpasha.com/blog (“the Blog”), run by Emir YILDIRIM (“I”, “me”). By creating an account you agree to them.</p>
      <h2>1. Who can use the Blog</h2>
      <p>You must be at least 13 years old (or the minimum age for online services in your country, if higher) to create an account. Anyone can read posts without an account.</p>
      <h2>2. Your account</h2>
      <p>You are responsible for keeping your password secret and for everything posted from your account. Use a password you don't use anywhere else.</p>
      <h2>3. What you post</h2>
      <ul>
        <li>You keep ownership of what you post. By posting, you allow the Blog to store and show it publicly.</li>
        <li>Posts, comments, likes and dislikes are public. Don't post personal information you don't want everyone to see.</li>
        <li>Don't post anything illegal, hateful, harassing, sexually explicit, spam, malware, or anything that infringes someone else's copyright or privacy.</li>
        <li>Only upload images you have the right to share.</li>
      </ul>
      <h2>4. Moderation</h2>
      <p>I can delete any post, comment or account at any time, with or without notice, for example if it breaks these terms.</p>
      <h2>5. Your data and privacy</h2>
      <ul>
        <li>I store your email address, username, password, posts, comments, votes and uploaded images. This data is stored with Supabase, a database hosting provider; it is <strong>not</strong> stored in the Blog's public source code.</li>
        <li>Passwords are stored only as secure one-way hashes, so nobody, including me, can read your password.</li>
        <li>Your email address is never shown publicly and is never sold or shared for marketing.</li>
        <li>You can ask me to delete your account and all your data at any time by contacting me through <a href="https://github.com/ENux-Distro">github.com/ENux-Distro</a>.</li>
      </ul>
      <h2>6. No warranty</h2>
      <p>The Blog is a personal project provided “as is”, without guarantees that it will always be available or free of errors. Opinions in posts are those of their authors.</p>
      <h2>7. Changes</h2>
      <p>I may update these terms. If the changes are important, I'll announce them on the Blog. Continuing to use your account after a change means you accept the new terms.</p>
    </article>`);
  }

  // ───────────── Global click handling ─────────────
  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) {
      // Clicking a feed card (but not a link/button inside it) opens the post.
      const card = e.target.closest("[data-href]");
      if (card && !e.target.closest("a, button") && !window.getSelection()?.toString()) location.hash = card.dataset.href;
      return;
    }
    e.preventDefault(); e.stopPropagation();
    const postId = el.closest("[data-post]")?.dataset.post;
    const p = postId && postCache.get(postId);

    switch (el.dataset.action) {
      case "logout":
        await sb.auth.signOut();
        location.hash = "#/";
        break;

      case "vote": {
        if (!p || !requireLogin("like or dislike posts")) return;
        const value = Number(el.dataset.value);
        const prev = p.my_vote ?? 0;
        const next = prev === value ? 0 : value; // clicking again removes the vote
        const { error } = next === 0
          ? await sb.from("votes").delete().eq("post_id", p.id).eq("user_id", myId())
          : await sb.from("votes").upsert({ post_id: p.id, user_id: myId(), value: next });
        if (error) { toast(friendlyError(error)); return; }
        if (prev === 1) p.likes--; if (prev === -1) p.dislikes--;
        if (next === 1) p.likes++; if (next === -1) p.dislikes++;
        p.my_vote = next || null;
        const row = el.closest(".actions");
        row.outerHTML = actionsRow(p, { full: !row.closest(".clickable") });
        break;
      }

      case "share": {
        const url = `${location.origin}${location.pathname}#/post/${postId}`;
        if (navigator.share) {
          try { await navigator.share({ title: p?.title, url }); } catch { /* cancelled */ }
        } else {
          try { await navigator.clipboard.writeText(url); toast("Link copied to clipboard."); }
          catch { prompt("Copy this link:", url); }
        }
        break;
      }

      case "delete-post": {
        if (!confirm("Delete this post? This can't be undone.")) return;
        const { error } = await sb.from("posts").delete().eq("id", postId);
        if (error) { toast(friendlyError(error)); return; }
        toast("Post deleted.");
        if (location.hash.startsWith("#/post/")) location.hash = "#/";
        else el.closest(".post")?.remove();
        break;
      }

      case "delete-comment": {
        if (!confirm("Delete this comment?")) return;
        const cid = el.closest("[data-comment]").dataset.comment;
        const { error } = await sb.from("comments").delete().eq("id", cid);
        if (error) { toast(friendlyError(error)); return; }
        el.closest(".comment").remove();
        if (p) p.comment_count--;
        break;
      }

      case "delete-user": {
        const name = el.dataset.username;
        if (prompt(`This permanently deletes @${name} and ALL their posts, comments and votes.\nType the username to confirm:`) !== name) return;
        const { error } = await sb.rpc("admin_delete_user", { target: el.dataset.user });
        if (error) { toast(friendlyError(error)); return; }
        toast(`@${name} was deleted.`);
        location.hash = "#/";
        break;
      }
    }
  });

  // ───────────── Router ─────────────
  let cleanup = null;
  async function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    document.title = "Emir's Blog";
    window.scrollTo(0, 0);
    const h = location.hash.replace(/^#/, "") || "/";
    if (!sb) {
      render(`<div class="setup-warning"><strong>Almost there.</strong> Fill in your Supabase URL and anon key in <code>config.js</code> (see SETUP.md).</div>`);
      return;
    }
    let m;
    if (h === "/") return pageFeed();
    if ((m = h.match(/^\/post\/(\d+)$/))) return pagePost(m[1]);
    if (h === "/new") return pageNew();
    if (h === "/login") return pageLogin();
    if (h === "/signup") return pageSignup();
    if (h === "/tos") return pageTos();
    render(`<div class="empty">Page not found. <a href="#/">Go to the feed</a></div>`);
  }

  async function start() {
    if (!sb) return route();
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    await loadProfile();
    sb.auth.onAuthStateChange((event, session) => {
      const changedUser = (session?.user?.id || null) !== (state.session?.user?.id || null);
      state.session = session;
      // Deferred: supabase-js deadlocks if its own calls are awaited inside this callback.
      if (changedUser) setTimeout(async () => { await loadProfile(); route(); }, 0);
    });
    window.addEventListener("hashchange", route);
    route();
  }

  start();
})();
