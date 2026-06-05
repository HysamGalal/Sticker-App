/* global React, TEAMS, STICKERS, TRADERS, TRADER_INVENTORIES, ACTIVITY, STICKERS_PER_TEAM,
          Sticker, Nav, Stat, Avatar */

// ─── Home / Landing ──────────────────────────────────────────────────────

function HomeScreen({ onRoute, onPickTeam }) {
  // Pick 4 "hero stack" stickers — a colorful mix
  const heroStickers = [
    STICKERS.find((s) => s.team === 'ARG' && s.number === 10),
    STICKERS.find((s) => s.team === 'BRA' && s.number === 0),
    STICKERS.find((s) => s.team === 'JPN' && s.number === 7),
    STICKERS.find((s) => s.team === 'MEX' && s.number === 9),
  ].filter(Boolean).map((s) => ({ ...s, count: 1 })); // force "owned" look for hero

  // Featured teams = first 4 (hosts + ARG)
  const featured = TEAMS.slice(0, 4).map((t) => {
    const teamStickers = STICKERS.filter((s) => s.team === t.code);
    const owned = teamStickers.filter((s) => s.count > 0).length;
    return { ...t, owned, total: STICKERS_PER_TEAM };
  });

  return (
    <div className="page">
      <section className="container hero">
        <div>
          <div className="hero-eyebrow">
            <span className="hero-dot" />
            <span className="eyebrow">Trading is open · Summer 2026</span>
          </div>
          <h1 className="h-display">
            The album fills<br />faster when you<br /><em>trade</em>.
          </h1>
          <p className="body-lg" style={{ marginTop: 24, maxWidth: 480 }}>
            Track every sticker you own, find collectors with the ones you're missing,
            and propose fair swaps without packing tape or DMs.
          </p>
          <div className="hero-actions">
            <button className="btn primary lg" onClick={() => onRoute('album')}>
              Open my album
            </button>
            <button className="btn ghost lg" onClick={() => onRoute('trades')}>
              Browse traders
            </button>
          </div>
          <div className="hero-stats">
            <Stat num="12,847" label="Active traders" />
            <Stat num="84,210" label="Swaps this week" />
            <Stat num="48" label="Teams · 960 stickers" />
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-stack">
            {heroStickers.map((s) => <Sticker key={s.id} s={s} />)}
          </div>
        </div>
      </section>

      <section className="container section-tight">
        <div className="h-eyebrow-row">
          <span className="eyebrow">Featured groups</span>
          <span className="rule" />
          <button className="btn ghost sm" onClick={() => onRoute('album')}>View all 12 →</button>
        </div>
        <div className="featured-grid">
          {featured.map((t) => {
            const pct = Math.round((t.owned / t.total) * 100);
            return (
              <button key={t.code} className="featured-team" onClick={() => onPickTeam(t.code)}>
                <div className="featured-team-code">GROUP {t.group} · {t.code}</div>
                <div className="featured-team-name">{t.name}</div>
                <div>
                  <div className="featured-team-prog">
                    <span>{t.owned}/{t.total}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="progress-bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="container section">
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 48 }}>
          <div>
            <div className="h-eyebrow-row">
              <span className="eyebrow">Live activity</span>
              <span className="rule" />
            </div>
            <div className="activity">
              {ACTIVITY.map((a, i) => (
                <div key={i} className="activity-row">
                  <span className={`activity-dot ${a.tag}`} />
                  <span><span className="activity-who">{a.who}</span> <span style={{ color: 'var(--ink-2)' }}>{a.what}</span></span>
                  <span className="activity-when">{a.when}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="h-eyebrow-row">
              <span className="eyebrow">How it works</span>
              <span className="rule" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                {
                  title: 'Log what you have',
                  desc: 'Tap stickers as you peel them. Duplicates count automatically.',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                         stroke="currentColor" strokeWidth="1.6"
                         strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
                      <path d="m8 12.5 3 3 5-6" />
                    </svg>
                  ),
                },
                {
                  title: 'Find a match',
                  desc: "We surface collectors whose missing list overlaps with your dupes.",
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                         stroke="currentColor" strokeWidth="1.6"
                         strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="10" cy="10" r="6.5" />
                      <path d="m15 15 5 5" />
                    </svg>
                  ),
                },
                {
                  title: 'Propose a swap',
                  desc: 'Pick stickers for both sides of the trade. Both confirm. Ship and review.',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                         stroke="currentColor" strokeWidth="1.6"
                         strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8h13l-3-3" />
                      <path d="M20 16H7l3 3" />
                    </svg>
                  ),
                },
                {
                  title: 'Ship & confirm',
                  desc: 'Mail your envelope, mark as sent, confirm on arrival. Album updates automatically.',
                  icon: (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                         stroke="currentColor" strokeWidth="1.6"
                         strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7.5 12 3l9 4.5" />
                      <path d="M3 7.5v9L12 21l9-4.5v-9" />
                      <path d="M3 7.5 12 12l9-4.5" />
                      <path d="M12 12v9" />
                    </svg>
                  ),
                },
              ].map(({ title, desc, icon }) => (
                <div key={title} className="howto-row">
                  <div className="howto-icon">{icon}</div>
                  <div>
                    <div className="howto-title">{title}</div>
                    <div className="howto-desc">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Album ───────────────────────────────────────────────────────────────

function AlbumScreen({ stickers, onPickSticker, focusTeam }) {
  const [filter, setFilter] = React.useState('all');
  const [expanded, setExpanded] = React.useState(focusTeam ? new Set([focusTeam]) : new Set(TEAMS.map((t) => t.code)));

  React.useEffect(() => {
    if (focusTeam) {
      const el = document.getElementById(`team-${focusTeam}`);
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owned = stickers.filter((s) => s.count > 0).length;
  const total = stickers.length;
  const pct = Math.round((owned / total) * 100);
  const dupes = stickers.filter((s) => s.count > 1).length;
  const missing = stickers.filter((s) => s.count === 0).length;

  const passes = (s) => {
    if (filter === 'all') return true;
    if (filter === 'missing') return s.count === 0;
    if (filter === 'dupes') return s.count > 1;
    if (filter === 'owned') return s.count > 0;
    return true;
  };

  return (
    <div className="page">
      <section className="container">
        <div className="album-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>My collection · World Cup 2026</div>
            <div className="album-completion">
              <span className="album-completion-num tabular">{owned}</span>
              <span className="album-completion-of">/ {total} stickers</span>
              <span className="album-completion-pct mono tabular">{pct}%</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
              <span><b style={{ color: 'var(--ink)' }}>{dupes}</b> duplicates available to trade</span>
              <span>·</span>
              <span><b style={{ color: 'var(--ink)' }}>{missing}</b> still needed</span>
            </div>
          </div>
          <div className="album-filters">
            {[
              ['all', `All ${total}`],
              ['missing', `Missing ${missing}`],
              ['dupes', `Dupes ${dupes}`],
              ['owned', `Owned ${owned}`],
            ].map(([k, l]) => (
              <button key={k}
                      className={`album-filter ${filter === k ? 'active' : ''}`}
                      onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>

        {TEAMS.map((team) => {
          const all = stickers.filter((s) => s.team === team.code);
          const visible = all.filter(passes);
          if (visible.length === 0) return null;
          const teamOwned = all.filter((s) => s.count > 0).length;
          const isOpen = expanded.has(team.code);
          return (
            <div key={team.code} id={`team-${team.code}`} className="team-section">
              <div className="team-section-head" onClick={() => {
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(team.code)) next.delete(team.code);
                  else next.add(team.code);
                  return next;
                });
              }} style={{ cursor: 'pointer' }}>
                <span className="team-section-code">GROUP {team.group} · {team.code}</span>
                <span className="team-section-name">{team.name}</span>
                {team.host && <span className="tag accent">Host</span>}
                <span className="team-section-prog tabular">{teamOwned}/{STICKERS_PER_TEAM} · {Math.round(teamOwned / STICKERS_PER_TEAM * 100)}%</span>
              </div>
              {isOpen && (
                <div className="sticker-grid">
                  {visible.map((s) => (
                    <Sticker key={s.id} s={s} size="sm" onClick={() => onPickSticker(s)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

// ─── Sticker detail modal — opens from album, lists traders who have it ──

function StickerModal({ sticker, stickers, onClose, onStartTrade }) {
  if (!sticker) return null;
  const team = TEAMS[sticker.teamIndex];
  // Find traders offering this sticker
  const traders = TRADER_INVENTORIES.filter((t) => t.offers.includes(sticker.id));
  const owned = sticker.count > 0;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
            <div style={{ width: 100, flexShrink: 0 }}>
              <Sticker s={{ ...sticker, count: Math.max(sticker.count, 1) }} />
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                {team.code} · {team.name} · #{String(sticker.number).padStart(2, '0')}
              </div>
              <div className="h-card">{sticker.isBadge ? team.name : sticker.name}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {owned
                  ? <span className="tag accent">In your album{sticker.count > 1 ? ` · ${sticker.count} copies` : ''}</span>
                  : <span className="tag warn">Missing from your album</span>}
                <span className="tag">{sticker.position}</span>
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {!owned && (
          <>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              {traders.length} traders offering this sticker
            </div>
            <div className="modal-trader-list">
              {traders.length === 0 && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                  No one is offering this right now. We'll notify you when someone does.
                </div>
              )}
              {traders.map((t) => {
                // How many of OUR dupes does this trader want?
                const wantsFromUs = stickers.filter((s) => s.count > 1 && t.wants.includes(s.id)).length;
                return (
                  <button key={t.id} className="modal-trader" onClick={() => onStartTrade(t, sticker)}>
                    <Avatar name={t.name} color={t.avatar} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div className="modal-trader-meta">
                        <span>★ {t.rating}</span><span>·</span>
                        <span>{t.swaps} swaps</span><span>·</span>
                        <span>{t.city}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mono tabular" style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                        wants {wantsFromUs} of yours
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Propose trade →</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {owned && (
          <div style={{ color: 'var(--ink-2)', fontSize: 14 }}>
            You already have this sticker in your album.
            {sticker.count > 1 && ' Your extras are listed as available to trade.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Trades index ────────────────────────────────────────────────────────

function TradesScreen({ stickers, onStartTrade }) {
  // Rank traders by mutual benefit: (their offers we need) × (our dupes they want)
  const ranked = TRADER_INVENTORIES.map((t) => {
    const offersWeNeed = t.offers.filter((id) => {
      const s = stickers.find((s) => s.id === id);
      return s && s.count === 0;
    });
    const wantsWeHave = t.wants.filter((id) => {
      const s = stickers.find((s) => s.id === id);
      return s && s.count > 1;
    });
    return {
      ...t,
      offersWeNeedCount: offersWeNeed.length,
      wantsWeHaveCount: wantsWeHave.length,
      score: offersWeNeed.length * wantsWeHave.length,
    };
  }).sort((a, b) => b.score - a.score);

  return (
    <div className="page">
      <section className="container">
        <div className="album-head" style={{ borderBottom: 'none' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Browse traders</div>
            <h2 className="h-display" style={{ fontSize: 'clamp(36px, 4vw, 56px)' }}>
              Best matches for you
            </h2>
            <p className="body-lg" style={{ marginTop: 16, maxWidth: 560 }}>
              We rank traders by how much your duplicates overlap with their wishlist —
              and vice versa. Higher score = fairer trade, fewer messages.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, paddingTop: 24 }}>
          {ranked.map((t, i) => (
            <button key={t.id} className="card" style={{ textAlign: 'left', display: 'block' }}
                    onClick={() => onStartTrade(t, null)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <Avatar name={t.name} color={t.avatar} size={48} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 17 }}>{t.name}</div>
                    <div className="mono tabular" style={{ fontSize: 11, color: 'var(--muted)' }}>#{String(i + 1).padStart(2, '0')}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    ★ {t.rating} · {t.swaps} swaps · {t.city}
                  </div>
                </div>
                <div className="tag accent mono tabular">match {t.score}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>They offer</div>
                  <div className="tabular" style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                    {t.offersWeNeedCount}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>stickers you need</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>They want</div>
                  <div className="tabular" style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                    {t.wantsWeHaveCount}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>of your duplicates</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { HomeScreen, AlbumScreen, StickerModal, TradesScreen });
