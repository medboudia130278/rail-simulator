import { NextResponse } from 'next/server';

const PASSWORD = process.env.APP_PASSWORD || 'changeme';
const COOKIE   = 'rail_sim_auth';
const MAX_AGE  = 60 * 60 * 24 * 7; // 7 days

export function middleware(request) {

  // Already authenticated via cookie
  var cookie = request.cookies.get(COOKIE);
  if (cookie && cookie.value === PASSWORD) {
    return NextResponse.next();
  }

  var url = new URL(request.url);

  // Login form submitted (GET with ?pwd=...)
  var pwd = url.searchParams.get('pwd');
  if (pwd) {
    if (pwd === PASSWORD) {
      // Correct password -> set cookie and redirect to clean URL
      var cleanUrl = request.url.replace(/[?&]pwd=[^&]*/g, '').replace(/[?&]$/, '');
      var res = NextResponse.redirect(cleanUrl);
      res.cookies.set(COOKIE, PASSWORD, {
        httpOnly: true,
        secure:   true,
        sameSite: 'strict',
        maxAge:   MAX_AGE,
        path:     '/',
      });
      return res;
    } else {
      // Wrong password -> show login page with error
      return loginPage(true);
    }
  }

  // Not authenticated -> show login page
  return loginPage(false);
}

function loginPage(error) {
  var html = '<!DOCTYPE html>' +
    '<html lang="en"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Rail Wear Simulator</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0;}' +
    'body{background:#0d1f26;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
    '.card{background:#1a2f38;border:1px solid rgba(125,211,200,0.2);border-radius:14px;padding:48px 40px;width:360px;max-width:94vw;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.4);}' +
    '.logo{width:48px;height:48px;margin:0 auto 20px;background:rgba(125,211,200,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;}' +
    'h1{color:#e8f4f3;font-size:20px;font-weight:700;margin-bottom:6px;}' +
    'p{color:#6b9ea8;font-size:13px;margin-bottom:28px;line-height:1.5;}' +
    '.field{position:relative;margin-bottom:14px;}' +
    'input[type=password]{width:100%;padding:11px 14px;background:rgba(0,0,0,0.3);border:1px solid ' + (error ? 'rgba(248,113,113,0.5)' : 'rgba(125,211,200,0.25)') + ';border-radius:8px;color:#e8f4f3;font-size:14px;outline:none;transition:border 0.2s;}' +
    'input[type=password]:focus{border-color:rgba(125,211,200,0.6);}' +
    'input[type=password]::placeholder{color:#4a6a74;}' +
    'button{width:100%;padding:12px;background:rgba(125,211,200,0.15);border:1px solid rgba(125,211,200,0.4);border-radius:8px;color:#7dd3c8;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.2s,transform 0.1s;}' +
    'button:hover{background:rgba(125,211,200,0.25);}' +
    'button:active{transform:scale(0.98);}' +
    '.error{color:#f87171;font-size:12px;margin-bottom:12px;padding:8px 12px;background:rgba(248,113,113,0.08);border-radius:6px;border:1px solid rgba(248,113,113,0.2);}' +
    '.hint{color:#4a6a74;font-size:11px;margin-top:16px;}' +
    '</style>' +
    '</head><body>' +
    '<div class="card">' +
    '<div class="logo">R</div>' +
    '<h1>Rail Wear Simulator</h1>' +
    '<p>Enter your password to access the simulator</p>' +
    (error ? '<div class="error">Incorrect password. Please try again.</div>' : '') +
    '<form method="GET" action="">' +
    '<div class="field"><input type="password" name="pwd" placeholder="Password" autofocus autocomplete="current-password"/></div>' +
    '<button type="submit">Access Simulator</button>' +
    '</form>' +
    '<div class="hint">Contact the administrator if you need access.</div>' +
    '</div>' +
    '</body></html>';

  return new NextResponse(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// Apply middleware to all routes except Next.js internals and static files
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
