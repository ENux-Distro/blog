# Setup

The site is plain HTML/CSS/JS served by GitHub Pages. Accounts, posts, likes,
comments and images live in [Supabase](https://supabase.com) (free tier), so
**no user data or passwords ever go into this repo**.

## 1. Create the Supabase project

1. Sign up at supabase.com and create a new project.
2. Open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Open **Authentication → Sign In / Providers → Email** and turn **off**
   "Confirm email" (so new accounts can post right away).
4. Open **Authentication → URL Configuration** and set the Site URL to
   `https://extras.emirpasha.com/blog/`.

## 2. Connect the site

Open **Project Settings → API** and copy the **Project URL** and the
**anon / public** key into [`config.js`](config.js). Both are meant to be
public. **Never** commit the `service_role` key.

## 3. Publish on GitHub Pages

1. Push this repo to GitHub as `blog`.
2. Repo **Settings → Pages**: deploy from the `main` branch, folder `/ (root)`.
3. If `extras.emirpasha.com` is already the custom domain of your GitHub Pages
   user site, this repo appears automatically at `extras.emirpasha.com/blog`.

## 4. Make yourself admin

Sign up on the live site, then run this in the Supabase SQL Editor:

```sql
update public.profiles set is_admin = true where username = 'YOUR_USERNAME';
```

Reload the site and "Admin" appears in the top-left corner.

## Running locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.
