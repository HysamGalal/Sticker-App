/* global React, ReactDOM, TEAMS, STICKERS, TRADER_INVENTORIES,
          Nav, HomeScreen, AlbumScreen, StickerModal, TradesScreen,
          TradeScreen, TradeSentModal,
          useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "editorial",
  "showActivity": true,
  "density": "comfy"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState('home');
  const [stickers, setStickers] = React.useState(STICKERS);
  const [openSticker, setOpenSticker] = React.useState(null);
  const [focusTeam, setFocusTeam] = React.useState(null);
  const [activeTrade, setActiveTrade] = React.useState(null); // { trader, prefilledWant }
  // Stickermanager-style: ids "reserved" by any open proposal. Locked until
  // the proposal completes or is cancelled.
  const [reservedIds, setReservedIds] = React.useState(new Set());

  // Apply theme to documentElement so CSS variables cascade everywhere.
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.theme);
    document.documentElement.style.setProperty('color-scheme', t.theme === 'stadium' ? 'dark' : 'light');
  }, [t.theme]);

  const ownedCount = stickers.filter((s) => s.count > 0).length;
  const totalCount = stickers.length;

  const startTrade = (trader, sticker) => {
    setActiveTrade({ trader, prefilledWant: sticker });
    setOpenSticker(null);
    setRoute('trade');
  };

  // —— Lifecycle hooks invoked by TradeScreen ——
  const reserveOnSend = (draft) => {
    // Mark the offered (give) stickers as reserved until the swap is finished
    setReservedIds((p) => {
      const next = new Set(p);
      draft.give.forEach((id) => next.add(id));
      return next;
    });
  };

  const onShip = () => {
    // Decrement count on reserved-give stickers (auto-remove from album)
    setStickers((all) => all.map((s) => {
      if (reservedIds.has(s.id) && s.count > 0) return { ...s, count: s.count - 1 };
      return s;
    }));
  };

  const onReceive = (gotIds) => {
    // Add received stickers to the album (count goes 0 -> 1)
    setStickers((all) => all.map((s) => gotIds.includes(s.id) ? { ...s, count: s.count + 1 } : s));
    // Clear reservations — trade complete
    setReservedIds(new Set());
  };

  const closeTrade = () => {
    setActiveTrade(null);
    setRoute('album');
  };

  return (
    <div className="app">
      <Nav route={route} onRoute={setRoute}
           ownedCount={ownedCount} totalCount={totalCount} />

      {route === 'home' && (
        <HomeScreen onRoute={setRoute}
                    onPickTeam={(code) => { setFocusTeam(code); setRoute('album'); }} />
      )}
      {route === 'album' && (
        <AlbumScreen stickers={stickers}
                     focusTeam={focusTeam}
                     onPickSticker={setOpenSticker} />
      )}
      {route === 'trades' && (
        <TradesScreen stickers={stickers}
                      onStartTrade={(trader) => startTrade(trader, null)} />
      )}
      {route === 'trade' && activeTrade && (
        <TradeScreen trader={activeTrade.trader}
                     prefilledWant={activeTrade.prefilledWant}
                     stickers={stickers}
                     reservedIds={reservedIds}
                     onBack={() => setRoute(activeTrade.prefilledWant ? 'album' : 'trades')}
                     onSendDraft={reserveOnSend}
                     onShip={onShip}
                     onReceive={onReceive}
                     onClose={closeTrade} />
      )}

      <StickerModal sticker={openSticker}
                    stickers={stickers}
                    onClose={() => setOpenSticker(null)}
                    onStartTrade={startTrade} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Aesthetic" />
        <TweakRadio label="Theme" value={t.theme}
                    options={[
                      { value: 'editorial', label: 'Editorial' },
                      { value: 'stadium',   label: 'Stadium'   },
                      { value: 'field',     label: 'Field'     },
                    ]}
                    onChange={(v) => setTweak('theme', v)} />
        <div style={{ fontSize: 11, color: 'rgba(41,38,27,.55)', lineHeight: 1.45 }}>
          <b>Editorial</b> — clean, neutral, serif headlines.<br />
          <b>Stadium</b> — dark, electric, sporty.<br />
          <b>Field</b> — warm cream, collector nostalgia.
        </div>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
