/** Same-origin page that lands the cookie, then moves on. A 302 can lose a SameSite=Strict cookie when the link comes from another app. */
export const SESSION_START_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>pi-everywhere</title>
  </head>
  <body>
    <script>location.replace("/");</script>
    <noscript><a href="/">Continue to pi-everywhere</a></noscript>
  </body>
</html>
`;
