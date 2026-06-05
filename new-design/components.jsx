/* global React, TEAMS, STICKERS, TRADERS, TRADER_INVENTORIES, ACTIVITY, STICKERS_PER_TEAM */

// ─── Sticker visual ──────────────────────────────────────────────────────
// Renders one sticker. For badge stickers (number 0) it shows abstract
// country-color stripes as a placeholder for what would be a team crest;
// for player stickers it shows a striped photo placeholder with a number,
// position, and surname. Intentionally generic — no real likenesses or
// logos.
function Sticker({ s, size = 'md', onClick, selected = false,
                   reserved = false, showValue = false }) {
  const team = TEAMS[s.teamIndex];
  const owned = s.count > 0;
  const isDup = s.count > 1;
  const cls = [
    'sticker',
    `size-${size}`,
    s.isBadge ? 'badge' : '',
    !owned ? 'missing' : '',
    isDup ? 'dup' : '',
    selected ? 'selected' : '',
    reserved ? 'reserved' : '',
  ].filter(Boolean).join(' ');
  const valueClass = s.value >= 130 ? 'scarce' : s.value < 90 ? 'abundant' : '';
  return (
    <div className={cls} data-count={s.count}
         onClick={reserved ? undefined : onClick}
         title={`${team.code} #${String(s.number).padStart(2, '0')} ${s.name}${isDup ? ` (×${s.count})` : ''} · value ${s.value}${reserved ? ' · reserved in another trade' : ''}`}>
      <div className="sticker-photo">
        {!s.isBadge && <span className="sticker-number">{String(s.number).padStart(2, '0')}</span>}
        {showValue && <span className={`sticker-value ${valueClass}`}>{s.value}</span>}
        {!s.isBadge && <span className="sticker-position">{s.position}</span>}
        {s.isBadge ? (
          <BadgeMark team={team} />
        ) : owned ? (
          <PlayerMark team={team} seed={s.number + s.teamIndex} />
        ) : null}
      </div>
      <div className="sticker-foot">
        <span className="sticker-name">{owned ? (s.isBadge ? team.name : s.name) : '— missing —'}</span>
        <span className="sticker-code">{team.code}</span>
      </div>
    </div>
  );
}

// Abstract "crest" — concentric arcs in team colors, country code centered.
// Not a real flag and not a real logo.
function BadgeMark({ team }) {
  return (
    <div className="sticker-flag" style={{ flexDirection: 'column' }}>
      {team.colors.map((c, i) => <i key={i} style={{ background: c }} />)}
      <div style={{
        position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
        fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 28,
        color: 'rgba(255,255,255,0.95)', textShadow: '0 1px 3px rgba(0,0,0,0.4)',
        letterSpacing: '0.04em',
      }}>{team.code}</div>
    </div>
  );
}

// Player "photo" placeholder — diagonal team-color bands with a silhouetted
// circle (head) over a tapering shape (shoulders). Distinct enough per
// position to feel hand-arranged, generic enough to read as placeholder.
function PlayerMark({ team, seed }) {
  const [c1, c2, c3] = [team.colors[0], team.colors[1] || team.colors[0], team.colors[2] || team.colors[0]];
  const angle = 110 + (seed % 5) * 8;
  return (
    <>
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(${angle}deg, ${c1} 0%, ${c1} 38%, ${c2} 38%, ${c2} 62%, ${c3} 62%)`,
        opacity: 0.85,
      }} />
      <svg viewBox="0 0 100 140" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} preserveAspectRatio="xMidYMax meet">
        <ellipse cx="50" cy="58" rx="18" ry="20" fill="rgba(0,0,0,0.25)" />
        <path d="M14,140 C14,108 30,92 50,92 C70,92 86,108 86,140 Z" fill="rgba(0,0,0,0.28)" />
      </svg>
    </>
  );
}

// ─── Nav ─────────────────────────────────────────────────────────────────

function Nav({ route, onRoute, ownedCount, totalCount }) {
  const pct = Math.round((ownedCount / totalCount) * 100);
  const items = [
    {
      id: 'home', label: 'Home',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      ),
    },
    {
      id: 'album', label: 'Album',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H6a2 2 0 0 0-2 2V4.5Z" />
          <path d="M4 20a2 2 0 0 1 2-2h14v3H6a2 2 0 0 1-2-2v-1" />
        </svg>
      ),
    },
    {
      id: 'wanted', label: 'Wanted',
      disabled: true,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3 1.8 5.4L19 9l-4 3.5L16.5 18 12 15l-4.5 3L9 12.5 5 9l5.2-.6L12 3Z" />
          <path d="M19 3.5v3M20.5 5h-3M5 18.5v2M6 19.5H4" />
        </svg>
      ),
    },
    {
      id: 'trades', label: 'Trades',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8h14l-3-3" />
          <path d="M20 16H6l3 3" />
        </svg>
      ),
    },
    {
      id: 'community', label: 'Community',
      disabled: true,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="3" />
          <circle cx="17" cy="10" r="2.5" />
          <path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5" />
          <path d="M14.5 19c.3-2 1.5-3.5 2.5-3.5s2.2 1.5 2.5 3.5" />
        </svg>
      ),
    },
    {
      id: 'activity', label: 'Activity',
      disabled: true,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 2 7 2 9H4c0-2 2-2 2-9Z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      ),
    },
    {
      id: 'profile', label: 'Profile',
      disabled: true,
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="10" r="3" />
          <path d="M5.5 19c1-2.5 3.5-4 6.5-4s5.5 1.5 6.5 4" />
        </svg>
      ),
    },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark">26</span>
        <span className="sidebar-logo-text">World Cup Stickers</span>
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <button key={item.id}
                  className={`sidebar-link ${route === item.id ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                  onClick={() => !item.disabled && onRoute(item.id)}
                  title={item.disabled ? 'Coming soon' : ''}>
            <span className="sidebar-link-icon">{item.icon}</span>
            <span className="sidebar-link-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-progress">
          <div className="sidebar-progress-meta">
            <span className="mono tabular">{ownedCount}/{totalCount}</span>
            <span className="mono tabular">{pct}%</span>
          </div>
          <div className="progress-bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>
    </aside>
  );
}

// ─── Small atoms ────────────────────────────────────────────────────────

function Stat({ num, label }) {
  return (
    <div>
      <div className="hero-stat-num tabular">{num}</div>
      <div className="hero-stat-lbl">{label}</div>
    </div>
  );
}

function Avatar({ name, color, size = 40 }) {
  const initials = name.split(' ').slice(0, 2).map((n) => n[0]).join('');
  return (
    <div className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.36 }}>
      {initials}
    </div>
  );
}

Object.assign(window, { Sticker, Nav, Stat, Avatar, BadgeMark, PlayerMark });
