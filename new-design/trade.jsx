/* global React, TEAMS, STICKERS, TRADER_INVENTORIES, Sticker, Avatar */

// ─── Trade Proposal Screen ───────────────────────────────────────────────
// Stickermanager-style trade lifecycle:
//   draft → sent → (accepted | countered | declined)
//        → "I've sent" → "I've received" → completed
// "Live swap" with online traders skips the wait state.

const STAGES = ['draft', 'sent', 'accepted', 'shipped', 'received', 'completed'];

function TradeScreen({ trader, prefilledWant, stickers, reservedIds,
                       onBack, onSendDraft, onShip, onReceive, onClose }) {
  const isLive = trader.online;

  // Draft state — selections build the proposal.
  const [give, setGive] = React.useState(new Set());
  const [get, setGet] = React.useState(prefilledWant ? new Set([prefilledWant.id]) : new Set());

  // Lifecycle stage. "Live swap" jumps draft → accepted on send.
  const [stage, setStage] = React.useState('draft');
  const [shipped, setShipped] = React.useState({ you: false, them: false });
  // Whether trader proposed a counter (we then re-enter draft with their picks)
  const [counterReason, setCounterReason] = React.useState(null);
  // Timestamp memos for the pipeline display.
  const [timeline, setTimeline] = React.useState({});

  // Pools (recomputed live; once stage > draft they're displayed but locked).
  const givePool = trader.wants
    .map((id) => stickers.find((s) => s.id === id))
    .filter((s) => s && s.count > 1);
  const getPool = trader.offers
    .map((id) => stickers.find((s) => s.id === id))
    .filter((s) => s && s.count === 0);

  const editable = stage === 'draft';

  const toggleGive = (id) => editable && setGive((p) => {
    const next = new Set(p); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleGet = (id) => editable && setGet((p) => {
    const next = new Set(p); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  // Value-based fairness (Stickermanager's "value" concept, summed).
  const giveStickers = [...give].map((id) => stickers.find((s) => s.id === id)).filter(Boolean);
  const getStickers  = [...get ].map((id) => stickers.find((s) => s.id === id)).filter(Boolean);
  const giveValue = giveStickers.reduce((a, s) => a + s.value, 0);
  const getValue  = getStickers.reduce((a, s) => a + s.value, 0);
  const valueDiff = getValue - giveValue;

  const fairness = (giveStickers.length === 0 && getStickers.length === 0)
    ? { label: 'Empty trade', tone: 'muted' }
    : Math.abs(valueDiff) <= 30
    ? { label: 'Fair value', tone: 'good' }
    : valueDiff > 30
    ? { label: `You get +${valueDiff} value`, tone: 'good' }
    : { label: `You give +${-valueDiff} value`, tone: 'warn' };

  // ─── Lifecycle transitions ─────────────────────────────────────────────

  const handleSend = () => {
    const now = Date.now();
    onSendDraft({ trader, give: [...give], get: [...get] });
    if (isLive) {
      // Live swap: accept instantly
      setTimeline({ sent: now, accepted: now });
      setStage('accepted');
    } else {
      setTimeline({ sent: now });
      setStage('sent');
      // Simulate partner response after ~2.5s. 70% accept, 30% counter.
      setTimeout(() => {
        if (Math.random() < 0.3 && giveStickers.length > 0) {
          // Counter: ask for one more of our dupes
          const extra = givePool.find((s) => !give.has(s.id));
          if (extra) {
            setGive((p) => new Set([...p, extra.id]));
            setCounterReason(`${trader.name} would like to add ${extra.name} (${TEAMS[extra.teamIndex].code} #${String(extra.number).padStart(2, '0')}) to balance the trade.`);
            setStage('draft');     // re-open for accept/reject
            setTimeline((t) => ({ ...t, countered: Date.now() }));
            return;
          }
        }
        setTimeline((t) => ({ ...t, accepted: Date.now() }));
        setStage('accepted');
      }, 2500);
    }
  };

  const handleShip = () => {
    setShipped((s) => ({ ...s, you: true }));
    onShip();
    // Simulate partner shipping ~1.5s later
    setTimeout(() => setShipped((s) => ({ ...s, them: true })), 1500);
    setTimeline((t) => ({ ...t, shipped: Date.now() }));
    setStage('shipped');
  };

  const handleReceive = () => {
    onReceive([...get]);
    setTimeline((t) => ({ ...t, received: Date.now(), completed: Date.now() }));
    setStage('completed');
  };

  const handleCancel = () => {
    if (stage === 'draft' && counterReason) {
      // Declining a counter — close out
      onBack();
    } else if (stage === 'sent') {
      onBack();
    } else {
      onBack();
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────

  const renderSlots = (ids, pool) => {
    const filled = ids.map((id) => pool.find((p) => p.id === id)).filter(Boolean);
    const target = Math.max(4, Math.ceil((filled.length + 1) / 4) * 4);
    const empties = editable ? Math.max(0, target - filled.length) : 0;
    return (
      <div className="trade-slot-grid">
        {filled.map((s) => (
          <div key={s.id} className="trade-slot filled"
               onClick={() => editable && (pool === givePool ? toggleGive(s.id) : toggleGet(s.id))}>
            <Sticker s={s} size="sm" showValue />
          </div>
        ))}
        {Array.from({ length: empties }).map((_, i) => (
          <div key={i} className="trade-slot">empty</div>
        ))}
      </div>
    );
  };

  return (
    <div className="page">
      <section className="container">
        <div className="trade-head">
          <button className="trade-back" onClick={onBack}>← Back</button>
          <div className="eyebrow">Trade proposal · {stageLabel(stage, counterReason)}</div>
        </div>

        <div className="trade-partner">
          <div style={{ position: 'relative' }}>
            <Avatar name={trader.name} color={trader.avatar} size={56} />
            {isLive && <span style={{ position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: '50%', background: 'oklch(0.72 0.18 145)', border: '2px solid var(--surface)' }} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 18 }}>Trading with {trader.name}</span>
              {isLive && <span className="tag live"><span className="live-dot" />Live swap</span>}
            </div>
            <div className="trade-partner-meta">
              <span>★ {trader.rating}</span><span>·</span>
              <span>{trader.swaps} completed swaps</span><span>·</span>
              <span>{trader.city}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost sm">Message</button>
            <button className="btn ghost sm">View profile</button>
          </div>
        </div>

        {/* Counter notice */}
        {counterReason && stage === 'draft' && (
          <div className="lifecycle-msg" style={{ marginBottom: 24, borderLeft: '3px solid var(--accent)' }}>
            <Avatar name={trader.name} color={trader.avatar} size={36} />
            <div className="lifecycle-msg-text">
              <b>{trader.name} sent a counter-offer.</b><br />
              {counterReason} Review the updated board below and accept, modify, or decline.
            </div>
          </div>
        )}

        {/* Trade board — visible in every stage, locks when stage > draft */}
        <div className="trade-board" style={{ opacity: stage === 'completed' ? 0.7 : 1 }}>
          <div className="trade-side">
            <div className="trade-side-head">
              <div>
                <div className="trade-side-title">You give</div>
                <div className="trade-side-sub">From your duplicates</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600 }}>{giveStickers.length}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>VALUE {giveValue}</div>
              </div>
            </div>

            {renderSlots([...give], givePool)}

            {editable && (
              <div className="trade-pool">
                <div className="trade-pool-head">
                  <span className="eyebrow">Your dupes they want · {givePool.length}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>tap to add</span>
                </div>
                <div className="trade-pool-grid">
                  {givePool.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', padding: 16, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
                      None of your duplicates match this trader's wishlist.
                    </div>
                  )}
                  {givePool.map((s) => (
                    <Sticker key={s.id} s={s} size="sm" showValue
                             selected={give.has(s.id)}
                             reserved={reservedIds.has(s.id) && !give.has(s.id)}
                             onClick={() => toggleGive(s.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="trade-arrow">⇄</div>

          <div className="trade-side">
            <div className="trade-side-head">
              <div>
                <div className="trade-side-title">You get</div>
                <div className="trade-side-sub">From their offers</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600 }}>{getStickers.length}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>VALUE {getValue}</div>
              </div>
            </div>

            {renderSlots([...get], getPool)}

            {editable && (
              <div className="trade-pool">
                <div className="trade-pool-head">
                  <span className="eyebrow">Their offers you need · {getPool.length}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>tap to add</span>
                </div>
                <div className="trade-pool-grid">
                  {getPool.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', padding: 16, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
                      This trader has no stickers you're missing right now.
                    </div>
                  )}
                  {getPool.map((s) => (
                    <Sticker key={s.id} s={s} size="sm" showValue
                             selected={get.has(s.id)}
                             onClick={() => toggleGet(s.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Draft footer */}
        {stage === 'draft' && (
          <div className="trade-summary">
            <div className="trade-summary-stats">
              <span><b className="tabular">{giveStickers.length}</b>giving</span>
              <span><b className="tabular">{getStickers.length}</b>getting</span>
              <span>
                <span className={`trade-fairness`}
                      style={fairness.tone === 'warn'
                        ? { background: 'color-mix(in oklch, var(--warn), transparent 85%)', color: 'var(--warn)' }
                        : fairness.tone === 'muted'
                        ? { background: 'var(--surface-2)', color: 'var(--muted)' }
                        : {}}>
                  ⚖ {fairness.label}
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn ghost" onClick={handleCancel}>
                {counterReason ? 'Decline counter' : 'Cancel'}
              </button>
              <button className="btn primary"
                      disabled={giveStickers.length === 0 || getStickers.length === 0}
                      onClick={handleSend}>
                {counterReason
                  ? 'Accept counter & send'
                  : isLive ? `Live swap with ${trader.name.split(' ')[0]}` : 'Send proposal'}
              </button>
            </div>
          </div>
        )}

        {/* Lifecycle panel for everything after draft */}
        {stage !== 'draft' && (
          <Lifecycle
            stage={stage}
            timeline={timeline}
            trader={trader}
            shipped={shipped}
            onShip={handleShip}
            onReceive={handleReceive}
            onDone={onClose}
            getCount={getStickers.length}
            giveCount={giveStickers.length}
          />
        )}
      </section>
    </div>
  );
}

function stageLabel(stage, counter) {
  if (stage === 'draft' && counter) return 'Counter received';
  return ({
    draft: 'Draft',
    sent: 'Awaiting response',
    accepted: 'Accepted',
    shipped: 'Items in the mail',
    received: 'Receipt confirmation',
    completed: 'Completed',
  })[stage] || stage;
}

// ─── Lifecycle pipeline ──────────────────────────────────────────────────

const PIPELINE = [
  { id: 'sent',      label: 'Proposal sent' },
  { id: 'accepted',  label: 'Accepted' },
  { id: 'shipped',   label: 'Shipped' },
  { id: 'received',  label: 'Received' },
  { id: 'completed', label: 'Completed' },
];

function Lifecycle({ stage, timeline, trader, shipped, onShip, onReceive, onDone,
                     getCount, giveCount }) {
  const stageIdx = STAGES.indexOf(stage);

  return (
    <div className="lifecycle">
      <div className="lifecycle-pipeline">
        {PIPELINE.map((step, i) => {
          const idx = STAGES.indexOf(step.id);
          const cls = idx < stageIdx ? 'done' : idx === stageIdx ? 'active' : '';
          return (
            <div key={step.id} className={`lifecycle-step ${cls}`}>
              <div className="lifecycle-step-num">{String(i + 1).padStart(2, '0')}</div>
              <div className="lifecycle-step-label">{step.label}</div>
              <div className="lifecycle-step-when">{relTime(timeline[step.id])}</div>
            </div>
          );
        })}
      </div>

      <div className="lifecycle-body">
        <div>
          {stage === 'sent' && (
            <div className="lifecycle-msg">
              <Avatar name={trader.name} color={trader.avatar} size={36} />
              <div className="lifecycle-msg-text">
                Waiting on <b>{trader.name}</b> to respond. They typically reply within an hour.
                Your {giveCount} stickers are marked as <b>reserved</b> in your album so they can't be offered in another trade.
                <div className="lifecycle-actions">
                  <button className="btn ghost sm" onClick={onDone}>Cancel proposal</button>
                </div>
              </div>
            </div>
          )}

          {stage === 'accepted' && (
            <div className="lifecycle-msg">
              <Avatar name={trader.name} color={trader.avatar} size={36} />
              <div className="lifecycle-msg-text">
                <b>{trader.name} accepted.</b> Pack your {giveCount} stickers and ship them to the address on the right.
                When the package goes in the mail, hit <b>I've sent the items</b> — your dupes will be removed from your album automatically.
                <div className="lifecycle-actions">
                  <button className="btn primary" onClick={onShip}>I've sent the items</button>
                  <button className="btn ghost">Open shipping label</button>
                </div>
              </div>
            </div>
          )}

          {stage === 'shipped' && (
            <div className="lifecycle-msg">
              <Avatar name={trader.name} color={trader.avatar} size={36} />
              <div className="lifecycle-msg-text">
                <b>Your items are in the mail.</b> {shipped.them
                  ? <>{trader.name} has also shipped — keep an eye on your mailbox.</>
                  : <>Waiting for {trader.name} to ship their {getCount} stickers.</>}
                <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)' }}>
                  <span>{shipped.you ? '✓' : '◯'} You shipped</span>
                  <span>{shipped.them ? '✓' : '◯'} {trader.name} shipped</span>
                </div>
                <div className="lifecycle-actions">
                  <button className="btn primary" disabled={!shipped.them} onClick={onReceive}>
                    {shipped.them ? `I've received the items` : `Waiting on ${trader.name.split(' ')[0]}…`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === 'completed' && (
            <div className="lifecycle-msg" style={{ background: 'var(--accent-soft)' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontSize: 18, fontWeight: 700 }}>✓</div>
              <div className="lifecycle-msg-text">
                <b>Trade complete.</b> Your {getCount} new stickers have been added to your album.
                Leave {trader.name.split(' ')[0]} a rating to help other collectors.
                <div className="lifecycle-actions">
                  <button className="btn primary">Leave a rating</button>
                  <button className="btn ghost" onClick={onDone}>Back to album</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Shipping address card — visible once accepted */}
        {(stage === 'accepted' || stage === 'shipped') && (
          <div className="ship-card">
            <span className="eyebrow">Ship to</span>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{trader.name}</div>
            <div className="ship-addr">{trader.address}</div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)', fontSize: 12, color: 'var(--muted)' }}>
              Use an envelope with a window — Album 26 generates a label with the address in the right place.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function relTime(ms) {
  if (!ms) return '—';
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

Object.assign(window, { TradeScreen });
