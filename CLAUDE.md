# Instructions for Claude

This is a public repository.

- **No session links.** Never put a Claude session URL (`claude.ai/code/session_...`) or a `Claude-Session:` trailer in
  commit messages, PR titles or bodies, code, comments or docs. A `Co-Authored-By` line is fine.
- **Always give a live preview.** For any change to the web app (`app/`), publish a preview the owner can click and use,
  not only a PR diff, and put that link at the top of the final reply. `app/` is plain static files: serve it with
  `npm run web` to test, and publish the same files as a preview page.
- Test in a real browser before pushing (`npm test` plus a headless Chromium pass over the changed UI).
- **Merge small asked-for changes.** When the owner explicitly asked for a change and it is small or moderate (not a large
  new feature or a design overhaul), merge the PR yourself (squash) as soon as `npm test` passes, the browser check is done
  and CI is green. Ask first only for large functional or design changes.
