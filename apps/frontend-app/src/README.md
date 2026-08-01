# Dashboard Source Map

Start with `app/bootstrap/index.js`, then `app/containers/App.js`. The shell
owns browser-wide providers and session/theme setup; `app/routes/AppRoutes.jsx`
owns route paths, guards, and lazy feature wiring.

- `auth/` contains authentication screens and helpers.
- `admin/` contains super-admin pages and passport type/module management.
- `user/` contains company-user dashboard features.
- `passports/` contains passport authoring and history flows.
- `passport-viewer/` contains the dashboard's passport preview/viewer feature.
- `manual/` contains the in-product documentation center.
- `audit/` and `dictionary/` are cross-cutting product features used by more
  than one route family.
- `shared/` contains reusable components and dependency-light utilities, not
  feature-specific pages. Its `styles/Dashboard.css` is a composition root;
  route-oriented dashboard styles live under `styles/dashboard/` in cascade
  order rather than in one monolithic stylesheet. The profile/list group has
  its own `styles/dashboard/profile-and-list.css` composition root and named
  `styles/dashboard/profile/` responsibility files.
- `admin/styles/AdminDashboard.css` is the matching admin composition root.
  Its Company Access, analytics, and passport-type support styles are split
  under `admin/styles/admin/company-access/` in the original cascade order.
- `shared/styles/CreatePass.css` is the passport create/edit composition root;
  its visual responsibilities live in `styles/create-pass/` in the original
  cascade order.
- `test/` contains frontend tests, including source-level wiring checks.

Keep new feature components, hooks, utilities, and styles close to the feature
that owns them. Move an item to `shared/` only after it has independent use in
more than one feature area.
