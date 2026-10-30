// ==UserScript==
// @name         Chess Analyzer (Maia-3)
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  Chess.com arrows from Maia-3, the human-move model: no Stockfish, no search, adjustable Elo (hotkey E)
// @author       Peenjeee (fork: Maia-3 engine + brilliant arrows)
// @match        https://www.chess.com/*
// @match        https://lichess.org/*
// @match        https://endgame.ai/*
// @match        https://www.endgame.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      localhost
// @connect      chess.0xpnj.dev
// @connect      cdn.jsdelivr.net
// @connect      huggingface.co
// @connect      cdn-lfs.huggingface.co
// @connect      cdn-lfs.hf.co
// @connect      lichess.org
// ==/UserScript==

(function() {
    'use strict';

    const SITE = location.hostname.includes('lichess') ? 'lichess'
        : location.hostname.includes('endgame') ? 'endgame'
        : 'chesscom';
    const EG_BOARD = '.board-container .board';

    // Relay (mirrors the game to the Chess Analyzer web app via its SSE API)
    const RELAY_URLS = location.hostname === 'localhost'
        ? ['http://localhost:5173/api/relay/']
        : ['https://chess.0xpnj.dev/api/relay/'];
    const RELAY_KEY = 'chessweb-relay-id';

    const hasGM = typeof GM_xmlhttpRequest === 'function'
        || (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function');

    function gmRequest(opts) {
        return new Promise((resolve, reject) => {
            let api = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : GM.xmlHttpRequest;
            api({
                method: opts.method || 'GET',
                url: opts.url,
                data: opts.data,
                headers: opts.headers,
                responseType: opts.responseType,
                onload: r => (r.status >= 200 && r.status < 300) ? resolve(r.response) : reject(new Error('HTTP ' + r.status)),
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(new Error('timeout'))
            });
        });
    }

    let iv = null;                 // analyzer loop interval
    let moves = [], ponder = "";
    let currentTurn = "w";
    let lastBoard = null;          // board element arrows were attached to

    async function fetchText(url) {
        try {
            let r = await fetch(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.text();
        } catch (e) {
            if (hasGM) return gmRequest({ url });
            throw e;
        }
    }

    async function fetchBytes(url) {
        try {
            let r = await fetch(url);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.arrayBuffer();
        } catch (e) {
            if (hasGM) return gmRequest({ url, responseType: 'arraybuffer' });
            throw e;
        }
    }

    function idbStore(mode, fn) {
        return new Promise(resolve => {
            try {
                let open = indexedDB.open('sa-engine', 1);
                open.onupgradeneeded = () => open.result.createObjectStore('files');
                open.onsuccess = () => {
                    let tx = open.result.transaction('files', mode);
                    tx.onerror = () => resolve(null);
                    fn(tx.objectStore('files'), resolve);
                };
                open.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    let idbGet = (key) => idbStore('readonly', (st, done) => {
        let g = st.get(key);
        g.onsuccess = () => done(g.result || null);
        g.onerror = () => done(null);
    });
    let idbPut = (key, buf) => idbStore('readwrite', (st, done) => {
        st.put(buf, key);
        st.transaction.oncomplete = () => done(true);
    });
    let idbDel = (key) => idbStore('readwrite', (st, done) => {
        st.delete(key);
        st.transaction.oncomplete = () => done(true);
    });

    // ------------------------------------------------------------------ board

    let getVP = (b, sq) => {
        let nodes = b.querySelectorAll(`.piece.${sq}`);
        for (let p of nodes) {
            if (p.style.display === 'none' || p.style.opacity === '0' || p.style.visibility === 'hidden') continue;
            if (p.classList.contains('ghost') || p.classList.contains('hint')) continue;
            return p;
        }
        return null;
    };

    function readBoardCC() {
        let b = document.querySelector(".board-layout-main wc-chess-board") || document.querySelector("wc-chess-board");
        if (!b) return null;

        let f = "";
        let lastMovedColor = null;
        let highlightCount = b.querySelectorAll('.highlight').length;
        let pieceMap = {};
        for (let p of b.querySelectorAll('.piece')) {
            if (p.style.display === 'none' || p.style.opacity === '0' || p.style.visibility === 'hidden') continue;
            if (p.classList.contains('ghost') || p.classList.contains('hint')) continue;
            let mSq = p.className.match(/\bsquare-(\d\d)\b/);
            if (mSq) pieceMap[mSq[1]] = p;
        }

        for (let i = 8; i >= 1; i--) {
            for (let j = 1; j <= 8; j++) {
                if (j === 1 && i !== 8) f += "/";
                let sqClass = `${j}${i}`;
                let pNode = pieceMap[sqClass];
                let m = pNode ? pNode.className.match(/\b([bw])([pbnrqk])\b/) : null;
                f += m ? (m[1] === 'w' ? m[2].toUpperCase() : m[2]) : "1";
                if (highlightCount === 2 && m && b.querySelector(`.highlight.square-${sqClass}`)) {
                    lastMovedColor = m[1];
                }
            }
        }
        if (!Object.keys(pieceMap).length) return null;

        if (lastMovedColor === 'w') currentTurn = 'b';
        else if (lastMovedColor === 'b') currentTurn = 'w';
        else if (highlightCount === 0) currentTurn = 'w';

        let castling = "";
        let hp = (c, sq) => { let p = getVP(b, sq); return p && p.className.includes(c); };
        if (hp('wk', 'square-51')) {
            if (hp('wr', 'square-81')) castling += "K";
            if (hp('wr', 'square-11')) castling += "Q";
        }
        if (hp('bk', 'square-58')) {
            if (hp('br', 'square-88')) castling += "k";
            if (hp('br', 'square-18')) castling += "q";
        }

        return {
            board: b,
            flipped: b.classList.contains("flipped"),
            fen: f.replace(/1+/g, m => m.length) + " " + currentTurn + " " + (castling || "-") + " - 0 1"
        };
    }

    // lichess variants by the key in the game's `variant-*` class. `uci` is the
    // engine's name for it and `nnue` Fairy-Stockfish's network for it; the
    // rest is what playableFen accepts: kings per
    // side (null: any number), what a king in check means (royal: it is that
    // side's turn; atomic: the same unless the kings touch; never: the board
    // was misread; none: kings are ordinary pieces), and whether castling and
    // white pawns on rank 1 occur. Other keys (chess960, fromPosition) stay standard.
    const STANDARD = { uci: 'chess', kings: [1, 1], check: 'royal', castling: true, firstRankPawns: false };
    const LI_VARIANTS = {
        kingOfTheHill: { ...STANDARD, uci: 'kingofthehill', nnue: 'kingofthehill-978b86d0e6a4' },
        threeCheck: { ...STANDARD, uci: '3check', nnue: '3check-cb5f517c228b' },
        crazyhouse: { ...STANDARD, uci: 'crazyhouse', nnue: 'crazyhouse-8ebf84784ad2' },
        atomic: { ...STANDARD, uci: 'atomic', nnue: 'atomic-2cf13ff256cc', check: 'atomic' },
        horde: { ...STANDARD, uci: 'horde', nnue: 'horde-28173ddccabe', kings: [0, 1], firstRankPawns: true },
        racingKings: { ...STANDARD, uci: 'racingkings', nnue: 'racingkings-636b95f085e3', check: 'never', castling: false },
        antichess: { ...STANDARD, uci: 'antichess', nnue: 'antichess-dd3cbe53cd4e', kings: null, check: 'none', castling: false }
    };

    function readBoardLI() {
        let b = document.querySelector('cg-board');
        if (!b) return null;
        let host = b.closest('.round__app, main.analyse');
        let rules = LI_VARIANTS[host?.className.match(/\bvariant-(\w+)/)?.[1]] || STANDARD;
        let wrap = b.closest('.cg-wrap') || document.querySelector('.cg-wrap');
        let flipped = !!wrap && wrap.classList.contains('orientation-black');
        let size = b.getBoundingClientRect().width / 8;
        if (!size) return null;

        // Drag state is temporary; while a piece is in flight, lichess board
        // transforms do not reflect the settled position yet.
        if (b.querySelector('piece.ghost') ||
            b.querySelector('piece.dragging') ||
            b.querySelector('piece.anim')) return null;

        const TYPES = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
        let sqOf = (el) => {
            let m = (el.style.transform || '').match(/translate\((-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?\)/);
            if (!m) return null;
            let col = Math.round(parseFloat(m[1]) / size), row = Math.round(parseFloat(m[2] || '0') / size);
            if (col < 0 || col > 7 || row < 0 || row > 7) return null;
            return flipped ? { f: 8 - col, r: row + 1 } : { f: col + 1, r: 8 - row };
        };

        let lastSquares = [];
        b.querySelectorAll('square.last-move').forEach(sq => {
            // chessground hides squares it no longer needs instead of removing them,
            // and a hidden one keeps the classes of an older move or selection
            if (sq.style.display === 'none') return;
            let s = sqOf(sq);
            if (s) lastSquares.push(s);
        });

        let grid = {};
        let lastColor = null;
        b.querySelectorAll('piece').forEach(p => {
            if (p.classList.contains('ghost')) return;
            let s = sqOf(p);
            if (!s) return;
            let color = p.classList.contains('white') ? 'w' : p.classList.contains('black') ? 'b' : null;
            let type = null;
            for (let k in TYPES) if (p.classList.contains(k)) { type = TYPES[k]; break; }
            if (!color || !type) return;
            grid[s.f + ',' + s.r] = color + type;
            if (lastSquares.some(q => q.f === s.f && q.r === s.r)) lastColor = color;
        });
        if (Object.keys(grid).length < 2) return null;

        if (lastColor === 'w') currentTurn = 'b';
        else if (lastColor === 'b') currentTurn = 'w';
        else {
            const isPuzzle = /^\/(training|streak|storm|racer)\b/.test(location.pathname) || !!document.querySelector('main.puzzle, .puzzle__board, [class*="puzzle"], .streak, .storm, .racer');
            if (isPuzzle && wrap) {
                currentTurn = flipped ? 'b' : 'w';
            } else {
                let active = host?.querySelector('move.active');
                let clock = document.querySelector('.rclock.running');
                if (active) currentTurn = (active.getAttribute('p') || '').length / 2 % 2 ? 'b' : 'w';
                else if (clock?.classList.contains('rclock-white')) currentTurn = 'w';
                else if (clock?.classList.contains('rclock-black')) currentTurn = 'b';
                else if (!lastSquares.length) currentTurn = 'w';
            }
        }

        let f = "";
        for (let r = 8; r >= 1; r--) {
            if (r < 8) f += "/";
            for (let c = 1; c <= 8; c++) {
                let pc = grid[c + ',' + r];
                f += pc ? (pc[0] === 'w' ? pc[1].toUpperCase() : pc[1]) : "1";
            }
        }
        let castling = "";
        if (rules.castling && grid['5,1'] === 'wk') {
            if (grid['8,1'] === 'wr') castling += "K";
            if (grid['1,1'] === 'wr') castling += "Q";
        }
        if (rules.castling && grid['5,8'] === 'bk') {
            if (grid['8,8'] === 'br') castling += "k";
            if (grid['1,8'] === 'br') castling += "q";
        }

        // Crazyhouse pockets sit beside the board: one piece per role, its count in data-nb
        let pocket = "";
        if (rules.uci === 'crazyhouse') {
            host.querySelectorAll('.pocket piece').forEach(p => {
                let type = Object.keys(TYPES).find(k => p.classList.contains(k));
                if (!type) return;
                let letter = p.classList.contains('white') ? TYPES[type].toUpperCase() : TYPES[type];
                pocket += letter.repeat(+p.dataset.nb || 0);
            });
            pocket = "[" + pocket + "]";
        }
        // Three-check: each check given shows as a king icon in the giver's
        // material bar; the engine wants the checks each side has left
        let checks = "";
        if (rules.uci === '3check') {
            let given = side => host.querySelectorAll(`.material-${side} mpiece.king`).length;
            let [byWhite, byBlack] = flipped ? [given('top'), given('bottom')] : [given('bottom'), given('top')];
            checks = Math.max(0, 3 - byWhite) + "+" + Math.max(0, 3 - byBlack) + " ";
        }

        return {
            board: b,
            flipped,
            rules,
            fen: f.replace(/1+/g, m => m.length) + pocket + " " + currentTurn + " " + (castling || "-") + " - " + checks + "0 1"
        };
    }

    // chess.com's variants server, by the slug in /variants/<slug>/game/<id>.
    // The lichess ones keep lichess's rules; the rest match Fairy-Stockfish's
    // variant of that name, with the Fairy-Stockfish project's own network where
    // one exists (Paradigm has none). On top of the keys above: pieces maps the server's
    // own piece names to FEN letters, walls turns its stones (colour 7) into
    // walls, and setup waits until the setup drops are over. No Castling and
    // Setup Chess are standard chess for SF19 once the board is read, and so is
    // Chess960, whose castling rights come from its start position. Any other
    // slug, custom rules and four-player boards included, is not supported.
    const CC_VARIANTS = {
        'chess960': { ...STANDARD, castling: false },
        'crazyhouse': LI_VARIANTS.crazyhouse,
        '3-check': LI_VARIANTS.threeCheck,
        'king-of-the-hill': LI_VARIANTS.kingOfTheHill,
        'atomic': LI_VARIANTS.atomic,
        'giveaway': LI_VARIANTS.antichess,
        'horde': LI_VARIANTS.horde,
        'racing-kings': LI_VARIANTS.racingKings,
        'no-castling': { ...STANDARD, castling: false },
        'setup-chess': { ...STANDARD, castling: false, setup: true },
        'torpedo': { ...STANDARD, uci: 'torpedo', nnue: 'torpedo-25da2c94c6cb' },
        'sideways-pawns': { ...STANDARD, uci: 'pawnsideways', nnue: 'pawnsideways-68b37e5c25b0' },
        // kings cannot capture there, so kings that touch give no check (as in atomic)
        'petrified': { ...STANDARD, uci: 'petrified', nnue: 'petrified-fa7e5810f172', walls: true, check: 'atomic' },
        'paradigm-chess30': { ...STANDARD, uci: 'paradigm', pieces: { 'Δ': 'b' } },
        // the server draws a piece under its display name when it has one, else its letter
        'seirawan-chess': { ...STANDARD, uci: 'seirawan', nnue: 'seirawan-432c65fe71fc', pieces: { hawk: 'h', H: 'h', seirawanElephant: 'e', E: 'e' } },
        // its ferz and elephant are not the queen and bishop the check test knows
        'chaturanga': { ...STANDARD, uci: 'chaturanga', nnue: 'chaturanga-1889e98f8d54', pieces: { chariot: 'r', elephant: 'b', I: 'b', F: 'q' }, check: 'none', castling: false },
        // kings are captured, not mated, so a king may stand attacked
        'duck-chess': { ...STANDARD, uci: 'duck', nnue: 'duck-ba21f91f5d81', check: 'none' }
    };

    // Seirawan: a piece still on its back-rank start square may bring a banked
    // piece in on its first move. The castling letters stand for the king and
    // rooks; the files of the other pieces are added while the bank holds any.
    function seirawanRights(grid, castling, bank) {
        let side = (color, rank, rights) => {
            if (!bank[color]) return rights;
            for (let [file, type] of [[2, 'n'], [3, 'b'], [4, 'q'], [6, 'b'], [7, 'n']]) {
                if (grid[file + ',' + rank] === color + type) rights += String.fromCharCode((color === 'w' ? 64 : 96) + file);
            }
            return rights;
        };
        return side('w', 1, castling.replace(/[kq]/g, '')) + side('b', 8, castling.replace(/[KQ]/g, ''));
    }

    // The moves played so far, as SAN, from the variants server's move list.
    // A duck chess turn shows where the duck went after its move ("Nf6 Θf1").
    function movesCV() {
        let list = document.querySelector('[class*=moves-list]')?.parentElement;
        if (!list) return [];
        return [...list.querySelectorAll('span')]
            .filter(s => !s.children.length)
            .map(s => s.textContent.trim().replace(/ Θ[a-h][1-8]$/, ''))
            .filter(t => /^(@?[NBRQKP]?[a-h]?[1-8]?x?[a-h][1-8](=[NBRQ])?|O-O(-O)?)[+#]?$/.test(t));
    }

    // the duck chess turn last read: move count and side, duck square, placement
    let duckTurn = { key: '', duckAt: -1, placement: '' };

    // The variants server draws its own board: pieces are divs with data-piece
    // and data-color (5 White, 6 Black, 7 stone) placed by transform in square
    // units, and each banked piece is one more div off the board's edge.
    function readBoardCV(relay = false) {
        let b = document.querySelector('.TheBoard-layers');
        let slug = location.pathname.match(/^\/variants\/([^/]+)/)?.[1] || '';
        let rules = CC_VARIANTS[slug];
        let idle = note => ({ board: b, flipped: false, fen: '', note });
        if (!rules) return idle("Variant not supported: " + (slug || 'this board'));
        // Maia-3 only knows chess; the variant boards still read, they just get no arrows
        if (!relay && rules.uci !== 'chess') return idle("Maia-3: standard chess only (" + slug + ")");
        let size = b.getBoundingClientRect().width / 8;
        if (!size) return null;
        // the bottom player box is player 0 (White) or 2 (Black)
        let flipped = document.querySelector('.playerbox-bottom [data-player]')?.dataset.player === '2';
        let sans = movesCV();
        // Setup Chess opens with drops until both sides have spent their points
        if (rules.setup && !/^[^@]/.test(sans[sans.length - 1] || '')) return idle("Waiting for the setup");

        let grid = {}, pocket = { w: '', b: '' };
        for (let p of b.querySelectorAll('.TheBoard-pieces .piece')) {
            let m = (p.style.transform || '').match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
            let name = p.dataset.piece || '';
            // the duck (Θ, colour 7 like a stone) blocks a square the way a wall does
            let type = name === 'Θ' ? '*' : rules.pieces?.[name] || (/^[PNBRQK]$/.test(name) ? name.toLowerCase() : null);
            let color = type === '*' ? '*' : { 5: 'w', 6: 'b', 7: rules.walls ? '*' : null }[p.dataset.color];
            if (!m || !color || !type) continue;
            let col = Math.round(+m[1] / size), row = Math.round(+m[2] / size);
            if (color !== '*' && (col < 0 || col > 7)) { pocket[color] += type; continue; }
            if (row < 0 || row > 7 || col < 0 || col > 7) continue;
            grid[(flipped ? 8 - col : col + 1) + ',' + (flipped ? row + 1 : 8 - row)] = color === '*' ? '*' : color + type;
        }
        if (Object.keys(grid).length < 2) return null;

        // The side to move has the bright clock; when neither runs, the number
        // of moves played says whose turn it is
        let running = [...document.querySelectorAll('.playerbox-component')]
            .find(x => /brightness\(100%\)/.test(x.querySelector('.clock-component')?.getAttribute('style') || ''));
        let player = running?.querySelector('[data-player]')?.dataset.player;
        let turn = player === '0' ? 'w' : player === '2' ? 'b' : sans.length % 2 ? 'b' : 'w';

        let f = "";
        for (let r = 8; r >= 1; r--) {
            if (r < 8) f += "/";
            for (let c = 1; c <= 8; c++) {
                let pc = grid[c + ',' + r];
                f += !pc ? "1" : pc === '*' ? '*' : pc[0] === 'w' ? pc[1].toUpperCase() : pc[1];
            }
        }
        // A duck chess turn is a move and then the duck. In between, the board
        // shows the move while the turn and the move list stand still; that is
        // no position, so the turn's arrows stay up until the duck is down. A
        // move that ends a turn always moves the duck.
        if (rules.uci === 'duck') {
            let key = sans.length + turn, duckAt = f.indexOf('*');
            if (duckTurn.key === key && duckTurn.duckAt === duckAt && duckTurn.placement !== f) return null;
            duckTurn = { key, duckAt, placement: f };
        }
        let castling = "";
        if (rules.castling && grid['5,1'] === 'wk') {
            if (grid['8,1'] === 'wr') castling += "K";
            if (grid['1,1'] === 'wr') castling += "Q";
        }
        if (rules.castling && grid['5,8'] === 'bk') {
            if (grid['8,8'] === 'br') castling += "k";
            if (grid['1,8'] === 'br') castling += "q";
        }
        let banked = rules.uci === 'crazyhouse' || rules.uci === 'seirawan';
        let banks = banked ? "[" + pocket.w.toUpperCase() + pocket.b + "]" : "";
        if (rules.uci === 'seirawan') castling = seirawanRights(grid, castling, pocket);
        // three-check: the checks each side has left, from the "+" moves in the list
        let checks = "";
        if (rules.uci === '3check') {
            let given = side => sans.filter((s, i) => i % 2 === side && /[+#]$/.test(s)).length;
            checks = Math.max(0, 3 - given(0)) + "+" + Math.max(0, 3 - given(1)) + " ";
        }
        return {
            board: b,
            flipped,
            rules,
            fen: f.replace(/1+/g, m => m.length) + banks + " " + turn + " " + (castling || "-") + " - " + checks + "0 1"
        };
    }

    // Toast notification for in-game tactical alerts
    function showToast(msg, bg = '#1e1b4b', border = '#6366f1', duration = 4000) {
        let el = document.getElementById('sa-toast');
        if (!el) {
            document.body.insertAdjacentHTML('beforeend', `<div id="sa-toast" style="position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:999999;padding:10px 18px;border-radius:8px;font:600 13px system-ui,-apple-system,sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:none;align-items:center;gap:8px;pointer-events:none;transition:opacity 0.2s ease;"></div>`);
            el = document.getElementById('sa-toast');
        }
        el.innerHTML = msg;
        el.style.background = bg;
        el.style.border = `1px solid ${border}`;
        el.style.display = 'flex';
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => { el.style.display = 'none'; }, 200);
        }, duration);
    }

    // Secret Queen: square of hidden queen from endgame.ai's game API.
    // Opponent stays hidden until revealed (server-side zero knowledge).
    // `revealed` array and DOM badges track both sides once revealed.
    let lastEGGrid = null, lastEGFlipped = false;
    // `secret` stays null until the API says whether this game is Secret Queen;
    // the overlay and alerts only show once it has said yes
    const SECRET_RETRY_MS = 5000;
    function newSecretState(gameId) {
        return { gameId, boardKey: '', ownSquare: null, revealed: [], inFlight: false, secret: null, start960: null, retryAt: 0, spectating: false, lastOppPawns: null, queenCapturedNotified: false, oppQueenFound: null };
    }
    let egSecret = newSecretState('');

    function extractSecretQueensFromFen(fen) {
        if (!fen) return { white: null, black: null };
        let ranks = fen.split(' ')[0].split('/');
        if (ranks.length !== 8) return { white: null, black: null };
        let board = {};
        for (let rIdx = 0; rIdx < 8; rIdx++) {
            let rankNum = 8 - rIdx;
            let colIdx = 1;
            for (let ch of ranks[rIdx]) {
                if (/\d/.test(ch)) {
                    colIdx += parseInt(ch, 10);
                } else {
                    let sq = String.fromCharCode(colIdx + 96) + rankNum;
                    board[sq] = ch;
                    colIdx++;
                }
            }
        }
        let whiteSQ = Object.keys(board).find(sq => board[sq] === 'Q' && sq !== 'd1') || null;
        let blackSQ = Object.keys(board).find(sq => board[sq] === 'q' && sq !== 'd8') || null;
        return { white: whiteSQ, black: blackSQ };
    }

    function applySecretQueenLeak(oppSQ, oppColor, sourceTag = 'WSS MOVE') {
        if (egSecret.secret !== true || !oppSQ || egSecret.oppQueenFound === oppSQ) return;
        egSecret.oppQueenFound = oppSQ;
        showToast(`🎯 <b>SECRET QUEEN LAWAN: ${oppSQ.toUpperCase()}!</b> (${sourceTag})`, '#581c87', '#c084fc', 12000);
        if (!egSecret.revealed.some(r => r.square === oppSQ)) {
            egSecret.revealed.push({ color: oppColor, square: oppSQ });
        }
        if (lastEGGrid) {
            let k = ('abcdefgh'.indexOf(oppSQ[0]) + 1) + ',' + oppSQ[1];
            if (lastEGGrid[k]) {
                lastEGGrid[k] = lastEGGrid[k][0] + 'q';
            }
        }
        let cell = document.querySelector(`.cell#${oppSQ}`);
        if (cell) {
            cell.style.boxShadow = 'inset 0 0 0 3px #c084fc, 0 0 15px rgba(192, 132, 252, 0.8)';
        }
        render(lastEGFlipped);
    }

    function pollEnemySecretQueen(state) {
        if (state.secret !== true || !state.gameId || state.oppQueenFound || state.pollingOpp) return;
        state.pollingOpp = true;
        fetch('/api/games/' + encodeURIComponent(state.gameId), { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(g => {
            if (g && Array.isArray(g.moves) && g.moves.length > 0) {
                let oppColor = lastEGFlipped ? 'w' : 'b';
                // 1. Scan from moves backwards for any queen moves from pawn starting squares
                for (let i = g.moves.length - 1; i >= 0; i--) {
                    let mStr = g.moves[i];
                    let mPiece = (mStr.match(/[?&]p=([^&\s]+)/) || [])[1];
                    let mFrom = (mStr.match(/[?&]cf=([^&\s]+)/) || [])[1];
                    let mFen = (mStr.match(/[?&]fen=([^&\s]+)/) || [])[1];

                    // Direct queen move by opponent piece
                    if (mPiece === 'q' + oppColor && mFrom) {
                        applySecretQueenLeak(mFrom, oppColor, 'OPPONENT QUEEN MOVE');
                        return;
                    }

                    // Check FEN for any unmasked queen
                    if (mFen) {
                        let sqs = extractSecretQueensFromFen(decodeURIComponent(mFen));
                        let oppSQ = oppColor === 'w' ? sqs.white : sqs.black;
                        if (oppSQ) {
                            applySecretQueenLeak(oppSQ, oppColor, 'GAME FEN LEAK');
                            return;
                        }
                    }
                }
            }
        })
        .catch(() => {})
        .finally(() => { state.pollingOpp = false; });
    }

    // Endgame.ai WebSocket (SignalR) real-time sniffer & hook
    if (SITE === 'endgame') {
        try {
            let hookScript = document.createElement('script');
            hookScript.textContent = `(${function() {
                if (window.__saWSHooked) return;
                window.__saWSHooked = true;
                const OrigWS = window.WebSocket;
                const WSProxy = new Proxy(OrigWS, {
                    construct(target, args) {
                        const ws = Reflect.construct(target, args);
                        const url = args[0];
                        if (typeof url === 'string' && url.includes('gamehub')) {
                            console.log('%c[SA-WSS] Connected to gamehub:', 'color:#3b82f6;font-weight:bold;', url);
                            window.__saActiveGameHubWS = ws;

                            const origSend = ws.send;
                            ws.send = function(data) {
                                try {
                                    if (typeof data === 'string') {
                                        let frames = data.split('\x1e').filter(Boolean);
                                        for (let frame of frames) {
                                            let json = JSON.parse(frame);
                                            if (json.target && (json.target.toLowerCase().includes('move') || json.target.toLowerCase().includes('play'))) {
                                                window.__saLastMoveTarget = json.target;
                                                console.log('%c[SA-WSS DETECTED MOVE METHOD]', 'color:#38bdf8;font-weight:bold;', json.target, json.arguments);
                                            }
                                        }
                                    }
                                } catch(e) {}
                                return origSend.apply(this, arguments);
                            };

                            window.addEventListener('sa-endgame-ws-send', (e) => {
                                try {
                                    const { from, to, promo } = e.detail || {};
                                    if (!from || !to) return;
                                    if (ws.readyState !== 1) return;
                                    const target = window.__saLastMoveTarget || 'Move';
                                    const moveUci = from + to + (promo ? promo.toLowerCase() : '');
                                    const payload = JSON.stringify({
                                        type: 1,
                                        target: target,
                                        arguments: [moveUci]
                                    }) + '\x1e';
                                    console.log('%c[SA-WSS DISPATCHING DIRECT MOVE]', 'color:#10b981;font-weight:bold;', payload);
                                    ws.send(payload);
                                } catch(err) {
                                    console.error('[SA-WSS] Move dispatch error:', err);
                                }
                            });

                            ws.addEventListener('message', (e) => {
                                if (typeof e.data === 'string') {
                                    let frames = e.data.split('\x1e').filter(Boolean);
                                    for (let frame of frames) {
                                        try {
                                            let json = JSON.parse(frame);
                                            let str = JSON.stringify(json);
                                            console.log('%c[SA-WSS FRAME]', 'color:#94a3b8;', json.target || json.type, json);
                                            if (json.target === 'secretQueenRevealed' || json.target === 'secretQueenSelected' || str.includes('secretQueen') || str.includes('SecretQueen')) {
                                                console.log('%c[SA-WSS SECRET QUEEN DATA]', 'color:#ef4444;font-weight:bold;font-size:13px;', json);
                                                window.dispatchEvent(new CustomEvent('sa-wss-reveal', { detail: json }));
                                            } else if (json.target === 'moved') {
                                                console.log('%c[SA-WSS MOVE]', 'color:#10b981;', json.arguments?.[0]);
                                                window.dispatchEvent(new CustomEvent('sa-wss-move', { detail: json.arguments?.[0] }));
                                            }
                                        } catch {
                                            if (frame.includes('secretqueen') || frame.includes('SecretQueen')) {
                                                console.log('%c[SA-WSS RAW]', 'color:#f59e0b;font-weight:bold;', frame);
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        return ws;
                    }
                });
                window.WebSocket = WSProxy;
            }})();`;
            (document.head || document.documentElement).appendChild(hookScript);
            hookScript.remove();
        } catch (e) {}

                                        window.addEventListener('sa-wss-reveal', (e) => {
                                            if (egSecret.secret !== true) return;
                                            let data = e.detail;
                                        if (data?.target === 'secretQueenRevealed') {
                                        let arg = data.arguments?.[0];
                                        if (arg?.square) {
                                        let col = arg.color;
                                        let sq = arg.square;
                                        applySecretQueenLeak(sq, col, 'WSS REVEAL EVENT');
                                        }
                                        } else if (data?.target === 'secretQueenSelected') {
                                        let sq = typeof data.arguments?.[0] === 'string' ? data.arguments[0] : data.arguments?.[0]?.square;
                                        let col = data.arguments?.[0]?.color;
                                        let oppColor = lastEGFlipped ? 'w' : 'b';
                                        if (sq && /^[a-h][1-8]$/.test(sq)) {
                                        if (col === oppColor || (egSecret.ownSquare && egSecret.ownSquare !== sq)) {
                                        applySecretQueenLeak(sq, oppColor, 'WSS SELECTION EVENT');
                                        } else {
                                            egSecret.ownSquare = sq;
                                        }
                                        }
                                        }
                                        });

                                        window.addEventListener('sa-wss-move', (e) => {
                                            if (egSecret.secret !== true) return;
                                            let moveStr = e.detail;
                                            if (typeof moveStr !== 'string') return;

                                            // Check if server rejected a move with secretqueen-revealed error
                                            if (moveStr.startsWith('error:secretqueen-revealed')) {
                                                let parts = moveStr.split(':');
                                                let col = parts[2] || null;
                                                let sq = parts[3] || null;
                                                if (sq) {
                                                    applySecretQueenLeak(sq, col, 'WSS ERROR REVEAL');
                                                    return;
                                                }
                                            }

                                            let mFen = (moveStr.match(/[?&]fen=([^&\s]+)/) || [])[1];
                                            if (!mFen) return;
                                            let sqs = extractSecretQueensFromFen(decodeURIComponent(mFen));
                                            let oppColor = lastEGFlipped ? 'w' : 'b';
                                            let oppSQ = oppColor === 'w' ? sqs.white : sqs.black;
                                            if (oppSQ) {
                                                applySecretQueenLeak(oppSQ, oppColor, 'WSS MOVE FEN');
                                            }
                                        });
                                        }

    function checkRevealedCaptures(revealed) {
        if (!Array.isArray(revealed) || egSecret.queenCapturedNotified) return;
        let oppColor = lastEGFlipped ? 'w' : 'b';
        let opp = revealed.find(r => r.color === oppColor);
        if (!opp || !opp.square) return;

        if (lastEGGrid) {
            let key = ('abcdefgh'.indexOf(opp.square[0]) + 1) + ',' + opp.square[1];
            let hasQueen = Object.values(lastEGGrid).includes(oppColor + 'q');
            let hasPawnAtStart = lastEGGrid[key] === oppColor + 'p';
            if (!hasQueen && !hasPawnAtStart) {
                egSecret.queenCapturedNotified = true;
                showToast(`👑 <b>SECRET QUEEN LAWAN TERMAKAN!</b><br>Pion dari petak <b>${opp.square.toUpperCase()}</b> yang kamu makan adalah Secret Queen lawan!`, '#450a0a', '#ef4444', 9000);
            } else if (opp.revealedAtMoveNumber !== null) {
                showToast(`⚡ <b>SECRET QUEEN LAWAN TERUNGKAP!</b><br>Lawan menggerakkan Secret Queen dari <b>${opp.square.toUpperCase()}</b>!`, '#312e81', '#6366f1', 6000);
            }
        }
    }

    function checkSecretQueenCaptures(grid, oppColor) {
        if (!grid || egSecret.secret !== true) return;
        let currentOppPawns = Object.keys(grid).filter(k => grid[k] === oppColor + 'p');
        if (egSecret.lastOppPawns === null) {
            egSecret.lastOppPawns = currentOppPawns.length;
            return;
        }
        if (currentOppPawns.length < egSecret.lastOppPawns) {
            egSecret.lastOppPawns = currentOppPawns.length;
            showToast(`⚠️ Pion lawan termakan! (Sisa ${currentOppPawns.length} calon Secret Queen)`, '#1e1b4b', '#6366f1', 3500);
            if (Array.isArray(egSecret.revealed)) {
                checkRevealedCaptures(egSecret.revealed);
            }
        }
    }

    // endgame.ai authenticates its API with a Bearer token kept in web storage,
    // not a cookie. It is only ever sent back to endgame.ai's own API here —
    // never logged and never part of the relay.
    function egAccessToken() {
        try {
            let raw = sessionStorage.getItem('session_key') || localStorage.getItem('session_key');
            let session = raw ? JSON.parse(raw) : null;
            return typeof session?.access_token === 'string' ? session.access_token : null;
        } catch (e) {
            return null;
        }
    }

    // The public game endpoint names the variant, and a Chess960 game's start
    // position, for anyone: players, spectators and logged-out visitors.
    // null: no answer yet, ask again later
    function fetchEGGame(gameId) {
        return fetch('/api/games/' + encodeURIComponent(gameId), { headers: { 'Accept': 'application/json' } })
            .then(r => {
                if (r.status === 404) return {};
                return r.ok ? r.json().then(g => g || {}) : null;
            });
    }

    // Once per game. A failed lookup is retried after a few seconds rather
    // than on the next move: a finished game's board never moves.
    function lookUpVariant(state) {
        if (Date.now() < state.retryAt) return;
        state.inFlight = true;
        state.retryAt = Date.now() + SECRET_RETRY_MS;
        fetchEGGame(state.gameId)
            .then(g => {
                if (!g || egSecret !== state) return;
                state.secret = g.variant === 'SecretQueen';
                state.start960 = g.variant === 'Chess960' && typeof g.startingFen === 'string' ? g.startingFen : null;

                // Check if public moves array leaks secret queens
                if (state.secret && Array.isArray(g.moves) && g.moves.length > 0) {
                    for (let mStr of g.moves) {
                        let mFen = (mStr.match(/[?&]fen=([^&\s]+)/) || [])[1];
                        if (mFen) {
                            let sqs = extractSecretQueensFromFen(decodeURIComponent(mFen));
                            let oppColor = lastEGFlipped ? 'w' : 'b';
                            let oppSQ = oppColor === 'w' ? sqs.white : sqs.black;
                            if (oppSQ) {
                                applySecretQueenLeak(oppSQ, oppColor, 'GAME MOVE FEN');
                            }
                        }
                    }
                }

                // overlay held back until now, board may not move again soon
                if (state.secret) render(lastEGFlipped);
            })
            .catch(() => {})
            .finally(() => { state.inFlight = false; });
    }

    // Your own hidden queen's square needs your login. One lookup per board
    // change, whatever the answer: the square only moves when your pawn does,
    // and the site refreshes an expired token (401) before the next move.
    function lookUpOwnSquare(state, boardKey) {
        if (!state.oppQueenFound) {
            fetchEGGame(state.gameId).then(g => {
                if (g && Array.isArray(g.moves) && g.moves.length > 0) {
                    let mFen = (g.moves[0].match(/[?&]fen=([^&\s]+)/) || [])[1];
                    if (mFen) {
                        let sqs = extractSecretQueensFromFen(decodeURIComponent(mFen));
                        let oppColor = lastEGFlipped ? 'w' : 'b';
                        let oppSQ = oppColor === 'w' ? sqs.white : sqs.black;
                        if (oppSQ) {
                            applySecretQueenLeak(oppSQ, oppColor, 'MOVE 1 FEN');
                        }
                    }
                }
            }).catch(() => {});
        }
        let token = egAccessToken();
        state.inFlight = true;
        state.boardKey = boardKey;
        let headers = { 'x-eg-platform': 'web' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        fetch('/api/games/' + encodeURIComponent(state.gameId) + '/secret-queen', { headers })
            .then(r => {
                if (r.status === 404) return { spectating: true };
                return r.ok ? r.json() : null;
            })
            .then(data => {
                if (!data || egSecret !== state) return;
                if (data.spectating) {
                    // not your game: no hidden square of yours to ask about
                    state.spectating = true;
                    return;
                }
                state.ownSquare = !data.ownRevealed && /^[a-h][1-8]$/.test(data.ownSquare || '')
                    ? data.ownSquare
                    : null;
                state.revealed = Array.isArray(data.revealed) ? data.revealed : [];
                checkRevealedCaptures(state.revealed);
            })
            .catch(() => {})
            .finally(() => { state.inFlight = false; });
    }

    function refreshOwnSecretQueen(boardKey) {
        let gameId = location.pathname.match(/^\/game\/([\w-]+)/)?.[1] || '';
        // new game, or board not on a game page: forget old game
        if (egSecret.gameId !== gameId) egSecret = newSecretState(gameId);
        if (!gameId) return;

        // Poll enemy secret queen continuously on board changes until found (only if variant is SecretQueen)
        if (egSecret.secret === true && !egSecret.oppQueenFound) {
            pollEnemySecretQueen(egSecret);
        }

        if (egSecret.inFlight) return;
        if (egSecret.secret === null) lookUpVariant(egSecret);
        else if (egSecret.secret && !egSecret.spectating && egSecret.boardKey !== boardKey) lookUpOwnSquare(egSecret, boardKey);
    }

    // Other boards (home preview, a previous game) can stay mounted, so pick
    // the largest one that has rendered its cells.
    function findBoardEG() {
        let best = null, bestArea = 0;
        for (let b of document.querySelectorAll(EG_BOARD)) {
            if (!b.querySelector('.cell#a1')) continue;
            let r = b.getBoundingClientRect();
            if (r.width * r.height > bestArea) { best = b; bestArea = r.width * r.height; }
        }
        return best;
    }

    function readBoardEG() {
        let b = findBoardEG();
        if (!b) return null;
        let a1 = b.querySelector('.cell#a1'), h8 = b.querySelector('.cell#h8');
        if (!a1 || !h8) return null;
        // Flipping reverses the cell order, so a1 ends up above h8.
        let flipped = a1.getBoundingClientRect().top < h8.getBoundingClientRect().top;

        let grid = {};
        let lastColor = null;
        b.querySelectorAll('.cell').forEach(cell => {
            let sq = cell.id.match(/^([a-h])([1-8])$/);
            let p = cell.querySelector('.piece');
            if (!sq || !p) return;
            let m = p.className.match(/\bpiece\s+([pnbrqk])([wb])\b/);
            if (!m) return;
            let type = (egSecret.secret === true && cell.querySelector('.secret-queen-badge')) ? 'q' : m[1];
            grid[('abcdefgh'.indexOf(sq[1]) + 1) + ',' + sq[2]] = m[2] + type;
            if (cell.classList.contains('lastMove')) lastColor = m[2];
        });
        // A half-rendered board without both kings will crash the engine.
        let pieces = Object.values(grid);
        if (pieces.filter(p => p === 'wk').length !== 1 || pieces.filter(p => p === 'bk').length !== 1) return null;

        refreshOwnSecretQueen(Object.entries(grid).sort().join(';'));
        if (egSecret.secret === true) {
            let own = egSecret.ownSquare;
            if (own) {
                let key = ('abcdefgh'.indexOf(own[0]) + 1) + ',' + own[1];
                if (grid[key] && grid[key][1] === 'p') grid[key] = grid[key][0] + 'q';
            }
            if (egSecret.oppQueenFound) {
                let oppSQ = egSecret.oppQueenFound;
                let oppColor = flipped ? 'w' : 'b';
                let key = ('abcdefgh'.indexOf(oppSQ[0]) + 1) + ',' + oppSQ[1];
                if (grid[key] && grid[key][1] === 'p') {
                    grid[key] = oppColor + 'q';
                }
            }
            if (Array.isArray(egSecret.revealed)) {
                egSecret.revealed.forEach(r => {
                    if (r?.square && /^[a-h][1-8]$/.test(r.square)) {
                        let key = ('abcdefgh'.indexOf(r.square[0]) + 1) + ',' + r.square[1];
                        if (grid[key] && grid[key][1] === 'p' && (!r.color || grid[key][0] === r.color)) {
                            grid[key] = grid[key][0] + 'q';
                        }
                    }
                });
            }
            checkSecretQueenCaptures(grid, flipped ? 'w' : 'b');
        }

        let lastMoveSquares = b.querySelectorAll('.cell.lastMove');
        if (lastColor === 'w') currentTurn = 'b';
        else if (lastColor === 'b') currentTurn = 'w';
        else if (!lastMoveSquares.length) currentTurn = 'w';
        else {
            // Fallback for mid-game if lastColor was null: detect active clock
            const clocks = document.querySelectorAll('[class*="clock"], [class*="timer"]');
            let activeSide = null;
            clocks.forEach(clk => {
                const style = clk.getAttribute('style') || '';
                const cls = clk.className || '';
                const isActive = cls.includes('active') || cls.includes('running') || cls.includes('purple') || style.includes('background');
                if (isActive) {
                    const r = clk.getBoundingClientRect();
                    const bRect = b.getBoundingClientRect();
                    const isBottom = r.top > (bRect.top + bRect.height / 2);
                    activeSide = isBottom ? (flipped ? 'b' : 'w') : (flipped ? 'w' : 'b');
                }
            });
            if (activeSide) currentTurn = activeSide;
        }

        let f = "";
        for (let r = 8; r >= 1; r--) {
            if (r < 8) f += "/";
            for (let c = 1; c <= 8; c++) {
                let pc = grid[c + ',' + r];
                f += pc ? (pc[0] === 'w' ? pc[1].toUpperCase() : pc[1]) : "1";
            }
        }
        let castling = "";
        if (grid['5,1'] === 'wk') {
            if (grid['8,1'] === 'wr') castling += "K";
            if (grid['1,1'] === 'wr') castling += "Q";
        }
        if (grid['5,8'] === 'bk') {
            if (grid['8,8'] === 'br') castling += "k";
            if (grid['1,8'] === 'br') castling += "q";
        }

        return {
            board: b,
            flipped,
            fen: f.replace(/1+/g, m => m.length) + " " + currentTurn + " " + (castling || "-") + " - 0 1"
        };
    }

    // chess.com's variants server has its own board; everywhere else on chess.com it is wc-chess-board
    let readBoardChesscom = relay => document.querySelector('.TheBoard-layers') ? readBoardCV(relay) : readBoardCC();
    let readBoard = { lichess: readBoardLI, endgame: readBoardEG, chesscom: readBoardChesscom }[SITE];

    // ----------------------------------------------------------------- arrows

    function ensureOverlay(b) {
        if (!b) return;
        if (lastBoard !== b) {
            document.getElementById("sa-arrows")?.remove();
            lastBoard = b;
        }
        if (!document.getElementById("sa-arrows")) {
            b.insertAdjacentHTML('beforeend', `<svg id="sa-arrows" viewBox="0 0 100 100" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;"></svg>`);
        }
    }

    // chess.com's brilliancy mark: a teal disc with !! on the square the move lands on
    function brilliantBadge(p) {
        // the corner of the square the move lands on, nudged inside the board
        let x = p.x > 87 ? p.x - 3.6 : p.x + 3.6;
        let y = p.y < 13 ? p.y + 3.6 : p.y - 3.6;
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="#00e5c0" stroke="#ffffff" stroke-width="0.6" />`
            + `<text x="${x}" y="${y + 0.1}" text-anchor="middle" dominant-baseline="central" font-size="3.7" font-weight="900" font-family="sans-serif" fill="#04302b">!!</text>`;
    }

    function draw(m, i, flip) {
        if (!m || m.length < 4) return "";
        let F = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
        let c = (f, r) => {
            let x = F[f], y = +r;
            if (!x || isNaN(y)) return null;
            if (flip) { x = 9 - x; y = 9 - y; }
            return { x: (x - 1) * 12.5 + 6.25, y: (8 - y) * 12.5 + 6.25 };
        };
        // teal for the move Maia likes, then its second and third choice
        let col = ["#00e5c0", "#ef4444", "#22c55e"][i] || "#00e5c0";
        // a crazyhouse drop (N@f3) rings the square and names the piece
        if (m[1] === '@') {
            let p = c(m[2], m[3]);
            if (!p) return "";
            return `<circle cx="${p.x}" cy="${p.y}" r="5" fill="none" stroke="${col}" stroke-width="1.2" stroke-opacity="0.9" />`
                + `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-size="5" font-weight="700" font-family="sans-serif" fill="${col}" fill-opacity="0.9">${m[0]}</text>`;
        }
        let p1 = c(m[0], m[1]), p2 = c(m[2], m[3]);
        if (!p1 || !p2) return "";
        let dx = Math.abs(F[m[2]] - F[m[0]]), dy = Math.abs(+m[3] - +m[1]);
        let isN = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
        let d = isN ? `M ${p1.x} ${p1.y} L ${p1.x} ${p2.y} L ${p2.x} ${p2.y}` : `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
        // a Seirawan gating move (b1c3h) brings the hawk or elephant in on the back-rank
        // square it leaves; a promotion to one starts on the rank before the last
        let gate = /^[he]$/.test(m[4] || '') && /^[18]$/.test(m[1]) ? `<text x="${p1.x}" y="${p1.y}" text-anchor="middle" dominant-baseline="central" font-size="5" font-weight="700" font-family="sans-serif" fill="${col}" fill-opacity="0.9">${m[4].toUpperCase()}</text>` : "";
        // a duck chess move (e2e4,e4c3) ends with the square the duck goes to
        let duckTo = m.match(/,[a-h][1-8]([a-h][1-8])$/)?.[1];
        let p3 = duckTo && c(duckTo[0], duckTo[1]);
        let duck = p3 ? `<circle cx="${p3.x}" cy="${p3.y}" r="5" fill="none" stroke="${col}" stroke-width="1.2" stroke-opacity="0.9" />`
            + `<text x="${p3.x}" y="${p3.y}" text-anchor="middle" dominant-baseline="central" font-size="5">🦆</text>` : "";
        return `<path d="${d}" fill="none" stroke="${col}" stroke-width="1.5" stroke-opacity="0.9" stroke-linejoin="round" marker-end="url(#arr-${i})" />`
            + gate + duck + (i === 0 ? brilliantBadge(p2) : "");
    }

    function renderEGThreats(flip) {
        if (SITE !== 'endgame' || egSecret.secret !== true || !lastEGGrid) return "";
        let oppColor = flip ? 'w' : 'b';
        let myColor = flip ? 'b' : 'w';

        let oppPawns = [];
        for (let k in lastEGGrid) {
            if (lastEGGrid[k] === oppColor + 'p') {
                let [c, r] = k.split(',').map(Number);
                oppPawns.push({ c, r });
            }
        }

        let pt = (c, r) => {
            let x = flip ? 9 - c : c;
            let y = flip ? 9 - r : r;
            return { x: (x - 1) * 12.5 + 6.25, y: (8 - y) * 12.5 + 6.25 };
        };

        let out = `<g id="sa-sq-threats">`;

        // If enemy Secret Queen is identified, draw a prominent crown badge!
        if (egSecret.oppQueenFound) {
            let sq = egSecret.oppQueenFound;
            let c = 'abcdefgh'.indexOf(sq[0]) + 1;
            let r = +sq[1];
            let p = pt(c, r);
            out += `<circle cx="${p.x}" cy="${p.y}" r="5.6" fill="#7c3aed" fill-opacity="0.5" stroke="#c084fc" stroke-width="1.3" />`;
            out += `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="central" font-size="6.5">👑</text>`;
        } else {
            // Statistical Heatmap of Secret Queen choices from real game telemetry
            let probs = oppColor === 'w' 
                ? { g2: '50%', a2: '25%', c2: '17%' }
                : { g7: '42%', e7: '25%', d7: '17%' };

            for (let sq in probs) {
                let c = 'abcdefgh'.indexOf(sq[0]) + 1;
                let r = +sq[1];
                let pieceAtSq = lastEGGrid[c + ',' + r];
                // Only show badge if the opponent pawn is still on this square
                if (pieceAtSq === oppColor + 'p') {
                    let p = pt(c, r);
                    let isTop = probs[sq] === '50%' || probs[sq] === '42%';
                    let borderCol = isTop ? '#eab308' : '#94a3b8';
                    let bgCol = isTop ? 'rgba(234, 179, 8, 0.25)' : 'rgba(100, 116, 139, 0.2)';
                    out += `<circle cx="${p.x}" cy="${p.y - 4.5}" r="3.2" fill="${bgCol}" stroke="${borderCol}" stroke-width="0.6" />`;
                    out += `<text x="${p.x}" y="${p.y - 4.3}" text-anchor="middle" dominant-baseline="central" font-size="2.6" font-weight="bold" fill="#fff">${probs[sq]}</text>`;
                }
            }
        }

        let pawnsToCast = egSecret.oppQueenFound
            ? oppPawns.filter(p => ('abcdefgh'[p.c - 1] + p.r) === egSecret.oppQueenFound)
            : [];

        if (pawnsToCast.length > 0) {
            let dirs = [[1,0], [-1,0], [0,1], [0,-1], [1,1], [-1,1], [1,-1], [-1,-1]];
            let threats = [];
            let openLines = [];

            for (let p of pawnsToCast) {
                for (let [dc, dr] of dirs) {
                    let nc = p.c + dc, nr = p.r + dr;
                    let endC = null, endR = null;
                    let hitMyPiece = false;
                    while (nc >= 1 && nc <= 8 && nr >= 1 && nr <= 8) {
                        let target = lastEGGrid[nc + ',' + nr];
                        if (target) {
                            if (target[0] === myColor) {
                                hitMyPiece = true;
                                endC = nc; endR = nr;
                            }
                            break;
                        }
                        endC = nc; endR = nr;
                        nc += dc; nr += dr;
                    }
                    if (endC !== null && endR !== null) {
                        let p1 = pt(p.c, p.r);
                        let p2 = pt(endC, endR);
                        if (hitMyPiece) {
                            threats.push({ p1, p2, target: { c: endC, r: endR } });
                        } else if (egSecret.oppQueenFound) {
                            openLines.push({ p1, p2 });
                        }
                    }
                }
            }

            for (let l of openLines) {
                out += `<line x1="${l.p1.x}" y1="${l.p1.y}" x2="${l.p2.x}" y2="${l.p2.y}" stroke="#a855f7" stroke-width="0.35" stroke-dasharray="1,2.5" stroke-opacity="0.3" />`;
            }
            for (let t of threats) {
                out += `<line x1="${t.p1.x}" y1="${t.p1.y}" x2="${t.p2.x}" y2="${t.p2.y}" stroke="#ef4444" stroke-width="0.9" stroke-dasharray="2,1.5" stroke-opacity="0.85" />`;
                out += `<circle cx="${t.p2.x}" cy="${t.p2.y}" r="3.2" fill="none" stroke="#ef4444" stroke-width="0.9" stroke-opacity="0.9" />`;
                out += `<circle cx="${t.p2.x}" cy="${t.p2.y}" r="1.2" fill="#ef4444" fill-opacity="0.9" />`;
            }
        }

        out += `</g>`;
        return out;
    }

    // Chess960 castling comes as king-takes-own-rook (f1h1). Draw where the
    // king lands, or the rook's move when the king already stands there.
    // The ponder move is read on the board after the best move, so a king
    // recapturing on the square a rook was just taken on stays a capture.
    function shown960(m, after) {
        if (!searchBoard960 || !m || m.length < 4 || m[1] === '@') return m;
        let board = searchBoard960;
        if (after && after.length >= 4 && after[1] !== '@') {
            board = board.map(row => row.slice());
            let [fr, fc, tr, tc] = [8 - +after[1], 'abcdefgh'.indexOf(after[0]), 8 - +after[3], 'abcdefgh'.indexOf(after[2])];
            if (board[fr] && board[tr]) { board[tr][tc] = board[fr][fc]; board[fr][fc] = ''; }
        }
        let at = sq => board[8 - +sq[1]]?.['abcdefgh'.indexOf(sq[0])] || '';
        let king = at(m.slice(0, 2)), rook = at(m.slice(2, 4));
        if (!/^[Kk]$/.test(king) || rook !== (king === 'K' ? 'R' : 'r')) return m;
        let short = m[2] > m[0], rank = m[1];
        let kingTo = (short ? 'g' : 'c') + rank;
        return kingTo !== m.slice(0, 2) ? m.slice(0, 2) + kingTo : m.slice(2, 4) + (short ? 'f' : 'd') + rank;
    }

    function render(flip) {
        let svg = document.getElementById("sa-arrows");
        if (!svg) return;
        let threats = renderEGThreats(flip);
        svg.innerHTML = `<defs>${["#00e5c0", "#ef4444", "#22c55e"].map((c, i) => `<marker id="arr-${i}" orient="auto" markerWidth="4" markerHeight="4" refX="3" refY="2"><polygon points="0,0 4,2 0,4" fill="${c}"/></marker>`).join('')}</defs>`
            + threats
            + [2, 1, 0].map(i => draw(shown960(moves[i]), i, flip)).join("");
    }

    // ------------------------------------------------------------ score badge

    function setScore(whiteCp, whiteMate, flip) {
        let btn = document.getElementById("sa-btn");
        if (!btn) return;
        let uScore = whiteMate !== null ? (flip ? -whiteMate : whiteMate) : (flip ? -whiteCp : whiteCp);
        let bg = "#6b7280", scStr = "";
        if (whiteMate !== null) {
            bg = uScore > 0 ? "#22c55e" : "#ef4444";
            scStr = (uScore > 0 ? "+M" : "-M") + Math.abs(uScore);
        } else if (whiteCp !== null) {
            bg = uScore > 30 ? "#22c55e" : (uScore < -30 ? "#ef4444" : "#6b7280");
            scStr = uScore === 0 ? "0.0" : (uScore > 0 ? "+" : "") + (uScore / 100).toFixed(1);
        }
        if (!scStr) return;
        let span = btn.querySelector('span');
        if (span) {
            span.style.background = bg;
            span.innerHTML = scStr;
        } else {
            btn.innerHTML = `Stop Analyzer <span style="background:${bg};color:white;padding:2px 6px;border-radius:4px;margin-left:5px">${scStr}</span>`;
        }
    }

// ==MAIA-CORE-START==
// Maia-3 reads a board as 64 square tokens (12 piece planes, 8 history copies)
// mirrored so the side to move is always White, and answers with one logit per
// (from, to) pair — 4096 quiet/capture moves plus 256 promotions, in that
// order. Nothing here searches: it is the policy head, masked to legal moves.

const MAIA_PIECE_ID = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const MAIA_KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const MAIA_KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAIA_DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAIA_STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function maiaColor(ch) {
    return ch ? (ch === ch.toUpperCase() ? 'w' : 'b') : '';
}

// FEN placement -> 64 squares, index 0 = a1, as the model's own square order
function maiaGrid(placement) {
    let rows = String(placement || '').split('/');
    if (rows.length !== 8) return null;
    let grid = new Array(64).fill('');
    for (let r = 0; r < 8; r++) {
        let file = 0;
        for (let ch of rows[r]) {
            if (ch >= '1' && ch <= '8') { file += +ch; continue; }
            if (!/[pnbrqkPNBRQK]/.test(ch) || file > 7) return null;
            grid[(7 - r) * 8 + file] = ch;
            file++;
        }
        if (file !== 8) return null;
    }
    return grid;
}

function maiaAttacked(grid, sq, byWhite) {
    let f = sq % 8, r = (sq - f) / 8;
    let mine = byWhite ? 'w' : 'b';
    let at = (ff, rr) => (ff < 0 || ff > 7 || rr < 0 || rr > 7) ? '' : grid[rr * 8 + ff];
    let is = (ch, type) => ch && ch.toLowerCase() === type && maiaColor(ch) === mine;

    // a pawn on r-1 (white) or r+1 (black) attacks this square
    for (let df of [-1, 1]) if (is(at(f + df, r + (byWhite ? -1 : 1)), 'p')) return true;
    for (let [df, dr] of MAIA_KNIGHT) if (is(at(f + df, r + dr), 'n')) return true;
    for (let [df, dr] of MAIA_KING) if (is(at(f + df, r + dr), 'k')) return true;
    for (let [dirs, types] of [[MAIA_DIAG, 'bq'], [MAIA_STRAIGHT, 'rq']]) {
        for (let [df, dr] of dirs) {
            for (let i = 1; i < 8; i++) {
                let ch = at(f + df * i, r + dr * i);
                if (!ch) continue;
                if (maiaColor(ch) === mine && types.includes(ch.toLowerCase())) return true;
                break;
            }
        }
    }
    return false;
}

function maiaApply(grid, mv) {
    let g = grid.slice();
    let p = g[mv.from];
    g[mv.from] = '';
    if (mv.promo) p = maiaColor(p) === 'w' ? mv.promo.toUpperCase() : mv.promo;
    // castling: the king arrives two files over, the rook jumps the other way
    if (p && p.toLowerCase() === 'k' && Math.abs((mv.to % 8) - (mv.from % 8)) === 2) {
        let home = mv.from - (mv.from % 8);
        if (mv.to % 8 === 6) { g[home + 5] = g[home + 7]; g[home + 7] = ''; }
        else { g[home + 3] = g[home]; g[home] = ''; }
    }
    g[mv.to] = p;
    return g;
}

// Every legal move, in the same set python-chess gives the official engine.
// En passant is skipped: the boards this runs on always carry '-' there.
function maiaLegal(grid, turn, castling) {
    let white = turn === 'w';
    let mine = white ? 'w' : 'b';
    let pseudo = [];
    let add = (from, to, promo) => pseudo.push({ from, to, promo: promo || '' });

    for (let sq = 0; sq < 64; sq++) {
        let p = grid[sq];
        if (!p || maiaColor(p) !== mine) continue;
        let f = sq % 8, r = (sq - f) / 8, t = p.toLowerCase();
        let on = (ff, rr) => (ff < 0 || ff > 7 || rr < 0 || rr > 7) ? null : grid[rr * 8 + ff];
        let free = ch => ch !== null && ch === '';
        let foe = ch => ch !== null && ch !== '' && maiaColor(ch) !== mine;

        if (t === 'p') {
            let dir = white ? 1 : -1;
            let last = white ? 7 : 0;
            let one = sq + dir * 8;
            if (one >= 0 && one < 64 && grid[one] === '') {
                if ((one - (one % 8)) / 8 === last) for (let pr of 'qrbn') add(sq, one, pr);
                else {
                    add(sq, one);
                    if (r === (white ? 1 : 6) && grid[sq + dir * 16] === '') add(sq, sq + dir * 16);
                }
            }
            for (let df of [-1, 1]) {
                let target = on(f + df, r + dir);
                if (!foe(target)) continue;
                let to = (r + dir) * 8 + f + df;
                if ((r + dir) === last) for (let pr of 'qrbn') add(sq, to, pr);
                else add(sq, to);
            }
        } else if (t === 'n' || t === 'k') {
            for (let [df, dr] of (t === 'n' ? MAIA_KNIGHT : MAIA_KING)) {
                let ch = on(f + df, r + dr);
                if (free(ch) || foe(ch)) add(sq, (r + dr) * 8 + f + df);
            }
        } else {
            let dirs = t === 'b' ? MAIA_DIAG : t === 'r' ? MAIA_STRAIGHT : MAIA_DIAG.concat(MAIA_STRAIGHT);
            for (let [df, dr] of dirs) {
                for (let i = 1; i < 8; i++) {
                    let ch = on(f + df * i, r + dr * i);
                    if (ch === null) break;
                    if (ch === '') { add(sq, (r + dr * i) * 8 + f + df * i); continue; }
                    if (maiaColor(ch) !== mine) add(sq, (r + dr * i) * 8 + f + df * i);
                    break;
                }
            }
        }
    }

    // castling rights come from the FEN; a 960 king off e1/e8 simply gets none
    let home = white ? 0 : 56;
    let king = white ? 'K' : 'k';
    if (grid[home + 4] === king) {
        let safe = sq => !maiaAttacked(grid, sq, !white);
        if (castling.includes(white ? 'K' : 'k') && grid[home + 7] === (white ? 'R' : 'r')
            && grid[home + 5] === '' && grid[home + 6] === ''
            && safe(home + 4) && safe(home + 5) && safe(home + 6)) add(home + 4, home + 6);
        if (castling.includes(white ? 'Q' : 'q') && grid[home] === (white ? 'R' : 'r')
            && grid[home + 1] === '' && grid[home + 2] === '' && grid[home + 3] === ''
            && safe(home + 4) && safe(home + 3) && safe(home + 2)) add(home + 4, home + 2);
    }

    let legal = [];
    for (let mv of pseudo) {
        let g = maiaApply(grid, mv);
        let at = g.indexOf(king);
        if (at >= 0 && maiaAttacked(g, at, !white)) continue;
        legal.push(mv);
    }
    return legal;
}

function maiaUci(mv) {
    let name = sq => 'abcdefgh'[sq % 8] + ((sq - (sq % 8)) / 8 + 1);
    return name(mv.from) + name(mv.to) + (mv.promo || '');
}

// The model's move vocabulary: from*64+to, then promotions filed by file pair
function maiaIndex(mv, turn) {
    let from = turn === 'b' ? (mv.from ^ 56) : mv.from;
    let to = turn === 'b' ? (mv.to ^ 56) : mv.to;
    if (mv.promo) return 4096 + ((from % 8) * 8 + (to % 8)) * 4 + 'qrbn'.indexOf(mv.promo);
    return from * 64 + to;
}

function maiaEntries(placement, turn, castling) {
    let grid = maiaGrid(placement);
    if (!grid) return [];
    return maiaLegal(grid, turn, castling || '-')
        .map(mv => ({ uci: maiaUci(mv), idx: maiaIndex(mv, turn) }));
}

// 64 x (12 pieces x 8 history) tokens, the side to move mirrored to White
function maiaTokens(placement, turn, history) {
    history = history || 8;
    let grid = maiaGrid(placement);
    let out = new Float32Array(64 * 12 * history);
    if (!grid) return out;
    let flip = turn === 'b';
    for (let sq = 0; sq < 64; sq++) {
        let p = grid[sq];
        if (!p) continue;
        let at = flip ? (sq ^ 56) : sq;
        let black = flip ? maiaColor(p) === 'w' : maiaColor(p) === 'b';
        let plane = MAIA_PIECE_ID[p.toLowerCase()] - 1 + (black ? 6 : 0);
        for (let h = 0; h < history; h++) out[at * 12 * history + h * 12 + plane] = 1;
    }
    return out;
}

// Softmax restricted to the legal moves, best first
function maiaProbs(logits, entries, count) {
    if (!entries.length) return [];
    let max = -Infinity;
    for (let e of entries) if (logits[e.idx] > max) max = logits[e.idx];
    let total = 0, scored = [];
    for (let e of entries) {
        let v = Math.exp(logits[e.idx] - max);
        total += v;
        scored.push({ uci: e.uci, p: v });
    }
    scored.sort((a, b) => b.p - a.p);
    return scored.slice(0, count || 3).map(s => ({ uci: s.uci, p: s.p / total }));
}

// [loss, draw, win] for the side to move -> centipawns, White's point of view
function maiaCp(value, turn) {
    let loss = value[0], draw = value[1], win = value[2];
    let s = Math.min(0.999, Math.max(0.001, win + draw / 2));
    let cp = Math.round(400 * Math.log10(s / (1 - s)));
    cp = Math.max(-1200, Math.min(1200, cp));
    return turn === 'b' ? -cp : cp;
}
// ==MAIA-CORE-END==
    // ----------------------------------------------------------------- engine
    // Maia-3 (CSSLab, AGPL-3.0) instead of Stockfish: a transformer that
    // predicts the move a human of a given rating would play. It looks at the
    // board once and scores all 4352 from-to pairs — no search, no 100MB+ NNUE
    // download — so the arrows suggest what a 1500 player would do, not the
    // engine's best line.
    //
    // The ONNX export runs on onnxruntime-web inside a module worker built from
    // blobs, the same way the old engine loaded: nothing here is fetched by the
    // page, so chess.com's script policy stays out of it.

    const MAIA_MODELS = [
        { file: 'maia3_79m_int32.onnx', label: '79M', mb: 313 },
        { file: 'maia3_23m_int32.onnx', label: '23M', mb: 92 },
        { file: 'maia3_5m_int32.onnx', label: '5M', mb: 22 }
    ];
    const MAIA_HF = 'https://huggingface.co/cstr/maia3-onnx-int32/resolve/main/';
    const MAIA_ELOS = [800, 1100, 1500, 1800, 2100, 2400];
    const ORT_VERSION = '1.31.1';
    const ORT_DIST = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';
    const ORT_LOAD_MS = 300000;

    let maiaWorker = null, maiaReady = false, maiaLoading = false, maiaFailed = false;
    let maiaModelIdx = 0;              // index into MAIA_MODELS of the size in use
    let maiaElo = 1500;                // the human strength the arrows aim at
    let maiaGen = 0;                   // bumped when an answer must no longer land
    let maiaRun = 0;
    let maiaBusy = false;
    let maiaReq = null;                // the request in flight: { id, gen, entries, turn }
    let maiaNames = null;              // tensor names the model declares
    let maiaLastFen = null;
    let maiaCrashed = false;           // one automatic rebuild after a dead worker
    let pendingFen = null;             // the position waiting for the engine
    let engineFlip = false;
    let searchTurn = 'w';
    let searchBoard960 = null;         // Maia has no 960 castling, kept for the arrows

    // Runs inside the worker: load the model once, then answer one position at a time.
    // ==MAIA-WORKER-START==
    function maiaEngineMain() {
        let session = null, eloType = 'int32';
        let say = (msg, transfer) => self.postMessage(msg, transfer || []);
        let elo = (v, name) => eloType === 'int64'
            ? new ort.Tensor('int64', BigInt64Array.from(v.map(BigInt)), [1])
            : new ort.Tensor('int32', Int32Array.from(v), [1]);
        let feed = (d) => {
            let f = {};
            f[d.names.tokens] = new ort.Tensor('float32', d.tokens, [1, 64, 96]);
            f[d.names.self] = elo([d.elo[0]], d.names.self);
            f[d.names.oppo] = elo([d.elo[1]], d.names.oppo);
            return f;
        };
        self.onmessage = async e => {
            let d = e.data || {};
            try {
                if (d.boot) {
                    let b = d.boot;
                    if (ort.env.wasm) {
                        ort.env.wasm.numThreads = 1;  // chess.com is not cross-origin isolated
                        ort.env.wasm.proxy = false;
                        ort.env.wasm.wasmPaths = { mjs: b.mjs, wasm: b.wasm };
                    }
                    ort.env.logLevel = 'error';
                    session = await ort.InferenceSession.create(new Uint8Array(b.model), {
                        graphOptimizationLevel: 'all'
                    });
                    say({ ready: true, inputs: session.inputNames, outputs: session.outputNames });
                    return;
                }
                if (d.run) {
                    let out;
                    try {
                        out = await session.run(feed(d));
                    } catch (err) {
                        // some Maia exports keep the Elo inputs at int64
                        eloType = eloType === 'int32' ? 'int64' : 'int32';
                        out = await session.run(feed(d));
                    }
                    let policy = out[d.names.policy].data;
                    let value = out[d.names.value].data;
                    say({ run: d.run, policy, value }, [policy.buffer, value.buffer]);
                }
            } catch (err) {
                say({ error: String((err && err.message) || err) });
            }
        };
    }
    // ==MAIA-WORKER-END==

    // The model names its tensors; find them rather than trusting one export
    function maiaPickNames(inputs, outputs) {
        let pick = (list, re, fallback) => list.find(n => re.test(n)) || list[fallback];
        return {
            tokens: pick(inputs, /token|board|pos/i, 0),
            self: pick(inputs, /self/i, 1),
            oppo: pick(inputs, /oppo|other|enemy/i, 2),
            policy: pick(outputs, /move|policy/i, 0),
            value: pick(outputs, /value|wdl|result/i, 1)
        };
    }

    async function cachedBytes(key, url) {
        let bytes = await idbGet(key);
        if (bytes) return bytes;
        bytes = await fetchBytes(url);
        await idbPut(key, bytes);
        return bytes;
    }

    // A worker whose module imports onnxruntime from a blob, so no request
    // leaves the page and the runtime's own wasm comes from a blob too.
    function maiaStart(libUrl, glueUrl, wasmUrl, modelBytes) {
        let src = 'import * as ort from ' + JSON.stringify(libUrl) + ';\n'
            + 'globalThis.ort = ort;\n(' + maiaEngineMain.toString() + ')();';
        let url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        let w = new Worker(url, { type: 'module' });
        maiaWorker = w;
        return new Promise((resolve, reject) => {
            let timer = setTimeout(() => fail('engine load timed out'), ORT_LOAD_MS);
            let fail = msg => {
                clearTimeout(timer);
                try { w.terminate(); } catch (e) { }
                if (maiaWorker !== w) return;
                maiaWorker = null;
                maiaReady = false;
                maiaBusy = false;
                reject(new Error(msg));
            };
            w.onerror = () => {
                let wasReady = maiaReady && maiaWorker === w;
                fail('engine worker failed');
                // a worker that dies mid-game gets one rebuilt session
                if (wasReady && iv && !maiaCrashed) {
                    maiaCrashed = true;
                    setTimeout(() => { maiaModelIdx = 0; maiaFailed = false; ensureEngine(); }, 2000);
                }
            };
            w.onmessage = e => {
                let d = e.data || {};
                if (maiaWorker !== w) return;             // a replaced worker stays quiet
                if (d.error) {
                    // the session is still fine: report the failed position, keep going
                    if (maiaReady) {
                        // the session lives on, but this position failed: drop it
                        // rather than retry it forever, the next move tries again
                        let b = document.getElementById("sa-btn");
                        if (b) b.innerHTML = "Maia-3: " + String(d.error).slice(0, 50);
                        maiaBusy = false;
                        maiaReq = null;
                        pendingFen = null;
                        return;
                    }
                    return fail(d.error);
                }
                if (d.ready) {
                    clearTimeout(timer);
                    maiaNames = maiaPickNames(d.inputs || [], d.outputs || []);
                    maiaReady = true;
                    resolve();
                    return;
                }
                if (d.run) maiaAnswer(d);
            };
            w.postMessage({ boot: { model: modelBytes, mjs: glueUrl, wasm: wasmUrl } }, [modelBytes]);
        });
    }

    async function ensureEngine() {
        if (maiaWorker || maiaLoading || maiaFailed || !iv) return;
        maiaLoading = true;
        let btn = document.getElementById("sa-btn");
        try {
            // the runtime itself, once, in ~15MB instead of a wasm engine
            let lib = URL.createObjectURL(new Blob([await fetchText(ORT_DIST + 'ort.wasm.min.mjs')], { type: 'text/javascript' }));
            let glue = URL.createObjectURL(new Blob([await fetchText(ORT_DIST + 'ort-wasm-simd-threaded.mjs')], { type: 'text/javascript' }));
            let wasm = URL.createObjectURL(new Blob([await fetchBytes(ORT_DIST + 'ort-wasm-simd-threaded.wasm')], { type: 'application/wasm' }));
            while (!maiaReady && maiaModelIdx < MAIA_MODELS.length) {
                let m = MAIA_MODELS[maiaModelIdx];
                if (btn) btn.innerHTML = "Loading Maia-3 " + m.label + "… (one-time ~" + m.mb + "MB)";
                let bytes = await cachedBytes('maia-' + m.file, MAIA_HF + m.file);
                if (!iv) return;                          // the analyzer was switched off
                if (maiaReady) break;
                try {
                    await maiaStart(lib, glue, wasm, bytes);
                } catch (e) {
                    maiaModelIdx++;                       // a size this browser cannot run
                }
            }
            if (!maiaReady) throw new Error('no model would load');
        } catch (err) {
            maiaFailed = true;
            let b = document.getElementById("sa-btn");
            if (b) b.innerHTML = "Maia-3 failed: " + String(err.message || err).slice(0, 60);
            return;
        } finally {
            maiaLoading = false;
        }
        if (btn && iv) btn.innerHTML = "Stop Analyzer";
        pump();
    }

    function pump() {
        if (!maiaReady || maiaBusy || !pendingFen) return;
        let fen = pendingFen;
        pendingFen = null;
        let [placement, turn, castling] = fen.split(' ');
        let entries = maiaEntries(placement, turn, castling);
        if (!entries.length) {
            moves = []; ponder = "";
            render(engineFlip);
            return;
        }
        maiaBusy = true;
        searchTurn = turn;
        let req = { id: ++maiaRun, gen: maiaGen, entries, turn, fen };
        maiaReq = req;
        let tokens = maiaTokens(placement, turn);
        maiaWorker.postMessage({ run: req.id, tokens, elo: [maiaElo, maiaElo], names: maiaNames }, [tokens.buffer]);
    }

    // One answer: rank the legal moves by the policy, then show the top three
    function maiaAnswer(d) {
        maiaBusy = false;
        let req = maiaReq;
        if (!req || d.run !== req.id || req.gen !== maiaGen || req.fen !== maiaLastFen) {
            pump();
            return;
        }
        maiaReq = null;
        if (!d.policy || !d.value) {
            pump();
            return;
        }
        moves = maiaProbs(d.policy, req.entries, 3).map(m => m.uci);
        ponder = "";
        setScore(maiaCp(d.value, req.turn), null, engineFlip);
        render(engineFlip);
        pump();
    }

    function analyzeWorker(fen, flip, variant, chess960) {
        engineFlip = flip;
        // Maia-3 knows standard chess only; variants keep their board reads but
        // get no arrows rather than wrong ones
        if (variant !== 'chess') {
            let btn = document.getElementById("sa-btn");
            if (btn) btn.innerHTML = "Maia-3: standard chess only";
            return;
        }
        maiaLastFen = fen;
        pendingFen = fen;
        ensureEngine();
    }

    // Nothing valid to analyze: end the wait so stale arrows don't return
    function idleEngine() {
        pendingFen = null;
        maiaReq = null;
        maiaGen++;
        moves = []; ponder = "";
    }

    function stopEngine() {
        maiaGen++;
        if (maiaWorker) {
            try { maiaWorker.terminate(); } catch (e) { }
        }
        maiaWorker = null;
        maiaReady = false;
        maiaBusy = false;
        maiaReq = null;
        pendingFen = null;
    }

    // How human the arrows are: an Elo the model samples its policy at
    function updateEloUI() {
        let btn = document.getElementById("sa-elo-btn");
        if (btn) btn.innerHTML = "Elo: " + maiaElo + " [E]";
    }

    function cycleElo() {
        let i = MAIA_ELOS.indexOf(maiaElo);
        maiaElo = MAIA_ELOS[(i + 1) % MAIA_ELOS.length];
        updateEloUI();
        if (maiaLastFen) {
            pendingFen = maiaLastFen;
            pump();
        }
    }

    // ------------------------------------------------------- position check
    // Boards read mid-animation or with a misread turn can be impossible;
    // the engine answers those with no move, so screen them first.

    function parsePlacement(placement) {
        let rows = placement.split('/');
        if (rows.length !== 8) return null;
        let board = [];
        for (let row of rows) {
            let cells = [];
            for (let ch of row) {
                if (/\d/.test(ch)) for (let k = 0; k < +ch; k++) cells.push('');
                else cells.push(ch);
            }
            if (cells.length !== 8) return null;
            board.push(cells);
        }
        return board;
    }

    // Is the square at (row, col) — row 0 is rank 8 — attacked by that color?
    function attackedBy(board, r, c, white) {
        let at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) ? board[rr][cc] : null;
        let is = (p, type) => !!p && (p === p.toUpperCase()) === white && p.toLowerCase() === type;
        let pawnRow = white ? r + 1 : r - 1;
        if (is(at(pawnRow, c - 1), 'p') || is(at(pawnRow, c + 1), 'p')) return true;
        for (let [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
            if (is(at(r + dr, c + dc), 'n')) return true;
        }
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if ((dr || dc) && is(at(r + dr, c + dc), 'k')) return true;
            }
        }
        for (let [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            let sliders = dr && dc ? 'bq' : 'rq';
            for (let k = 1; k < 8; k++) {
                let p = at(r + dr * k, c + dc * k);
                if (p === null) break;
                if (!p) continue;
                if (sliders.split('').some(t => is(p, t))) return true;
                break;
            }
        }
        return false;
    }

    // The FEN to analyze, or null when the board cannot be a real position.
    // Only the side to move can be in check, so a check fixes a misread turn.
    function playableFen(fen, rules = STANDARD) {
        let [placement, turn, ...rest] = fen.split(' ');
        // a crazyhouse pocket follows the placement in brackets
        let board = parsePlacement(placement.replace(/\[.*\]$/, ''));
        if (!board) return null;
        let kings = { K: [], k: [] };
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                let p = board[r][c];
                if (p === 'K' || p === 'k') kings[p].push([r, c]);
                if (p === 'p' && (r === 0 || r === 7)) return null;
                if (p === 'P' && (r === 0 || (r === 7 && !rules.firstRankPawns))) return null;
            }
        }
        if (rules.kings && (kings.K.length !== rules.kings[0] || kings.k.length !== rules.kings[1])) return null;
        if (rules.check === 'none') return fen;
        // atomic kings that touch cannot take each other, so neither is in check
        let touching = kings.K.length === 1 && kings.k.length === 1
            && Math.abs(kings.K[0][0] - kings.k[0][0]) <= 1 && Math.abs(kings.K[0][1] - kings.k[0][1]) <= 1;
        let inCheck = (own, byWhite) => own.length === 1 && !(rules.check === 'atomic' && touching)
            && attackedBy(board, own[0][0], own[0][1], byWhite);
        let whiteInCheck = inCheck(kings.K, false);
        let blackInCheck = inCheck(kings.k, true);
        if (whiteInCheck && blackInCheck) return null;
        if (rules.check === 'never' && (whiteInCheck || blackInCheck)) return null;
        if (whiteInCheck) turn = 'w';
        else if (blackInCheck) turn = 'b';
        return [placement, turn, ...rest].join(' ');
    }

    // --------------------------------------------------------------- chess960
    // A Chess960 side may castle with a rook while its king and that rook
    // still stand where they started, so the rights come from the game's
    // start position, which each site's game API names. One lookup per game.

    // Shredder-FEN rights (rook file letters, outer rook first)
    function castling960(placement, startFen) {
        let now = parsePlacement(placement), start = parsePlacement(startFen.split(' ')[0]);
        if (!now || !start) return '-';
        let rights = '';
        for (let [row, king, rook, fileA] of [[7, 'K', 'R', 65], [0, 'k', 'r', 97]]) {
            let kingFile = start[row].indexOf(king);
            if (kingFile < 0 || now[row][kingFile] !== king) continue;
            for (let f = 7; f >= 0; f--) {
                if (start[row][f] === rook && now[row][f] === rook) rights += String.fromCharCode(fileA + f);
            }
        }
        return rights || '-';
    }

    // chess.com's variants server is not in its game API. Its page keeps the
    // game it shows in the app's Pinia stores, which only the page's own
    // scripts can reach, so a script put into the page answers each read event
    // with that game. DOM events reach both sides at once, so a read returns
    // the game straight away.
    const CV_READ = 'chess-analyzer-variants-read';
    const CV_GAME = 'chess-analyzer-variants-game';

    // Runs in the page. Each move is [from, to, promotion, duck square, FEN
    // after, castle]: a duck chess turn is the move and then the duck, and the FEN
    // after a move is only kept where the relay needs it (a Seirawan piece
    // brought in, the end of Setup Chess's drops). Moves without squares (a
    // resignation, a timeout, a side done with its setup) are left out.
    // lastFen is the position after the last move, for a board the page hides.
    function variantsGameReader(readEvent, gameEvent) {
        document.addEventListener(readEvent, () => {
            let game = null;
            try {
                let stores = document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s;
                let g = stores.get('game');
                let start = g.startFen || '';
                let keepFen = m => /seirawanDrops/.test(start) || (/setupPoints/.test(start) && /^@/.test(m.from));
                let played = (stores.get('moves').moves || [])
                    .filter(m => !m.isIllegal && !(m.inVariation >= 0))
                    .filter(m => { let [move] = m.multimoves || [m]; return move.from && move.to; });
                game = {
                    gameNr: g.gameNr,
                    startFen: start,
                    gameOver: !!g.gameOver,
                    players: (g.players || []).map(p => (p && p.username) || ''),
                    lastFen: played.length ? played[played.length - 1].fen || '' : '',
                    moves: played
                        .map(m => {
                            let [move, duck] = m.multimoves || [m];
                            return [move.from, move.to, move.promoteTo || '', (duck && duck.piece === 'Θ' && duck.to) || '', keepFen(move) ? m.fen || '' : '', move.castle || ''];
                        })
                };
            } catch (e) {}
            document.dispatchEvent(new CustomEvent(gameEvent, { detail: JSON.stringify(game) }));
        });
    }

    let cvReply = null;
    if (SITE === 'chesscom' && location.pathname.startsWith('/variants')) {
        document.addEventListener(CV_GAME, e => { cvReply = e.detail; });
        try {
            let s = document.createElement('script');
            s.textContent = `(${variantsGameReader})(${JSON.stringify(CV_READ)}, ${JSON.stringify(CV_GAME)});`;
            document.documentElement.appendChild(s);
            s.remove();
        } catch (e) {
            console.warn('variants reader not installed', e);
        }
    }

    function readVariantsGame() {
        cvReply = null;
        document.dispatchEvent(new CustomEvent(CV_READ));
        try { return JSON.parse(cvReply); } catch (e) { return null; }
    }

    // The web app's names for the variants-server games it follows, by slug
    const CV_RELAY = {
        'chess960': 'chess960', 'crazyhouse': 'crazyhouse', '3-check': 'threeCheck', 'king-of-the-hill': 'kingOfTheHill',
        'atomic': 'atomic', 'giveaway': 'giveaway', 'horde': 'horde', 'racing-kings': 'racingKings',
        'no-castling': 'noCastling', 'setup-chess': 'setupChess', 'torpedo': 'torpedo', 'sideways-pawns': 'sidewaysPawns',
        'petrified': 'petrified', 'paradigm-chess30': 'paradigm', 'seirawan-chess': 'seirawan', 'chaturanga': 'chaturanga',
        'duck-chess': 'duck'
    };
    // The server's piece letters that Fairy-Stockfish writes differently
    const CV_LETTERS = { 'chaturanga': { I: 'B', F: 'Q' }, 'paradigm-chess30': { 'Δ': 'B' } };

    // The server writes a two-player game on its four-player 14x14 grid: rows
    // from the top, cells split by commas (x off the board, a number for that
    // many empty squares, Θ the duck, else a seat and a piece, 0 White and 2
    // Black, with d in front of a dead piece), then fields split by "-", the
    // seat to move first. The 8x8 board is files d-k of ranks 11 down to 4.
    function placement8x8(fen, letters = {}) {
        let rows = fen.split('-')[0].split('/');
        if (rows.length !== 14) return null;
        let ranks = [];
        for (let row of rows.slice(3, 11)) {
            let cells = [];
            for (let c of row.split(',')) {
                let m = c.match(/^d?([02])(.)$/u);
                let letter = m && (letters[m[2]] || m[2]);
                if (/^\d+$/.test(c)) for (let k = 0; k < +c; k++) cells.push('1');
                else if (c === 'Θ') cells.push('*');
                else cells.push(m && /^[A-Z]$/.test(letter) ? (m[1] === '0' ? letter : letter.toLowerCase()) : c === 'x' ? 'x' : '?');
            }
            let rank = cells.slice(3, 11);
            if (cells.length !== 14 || rank.some(c => c === 'x' || c === '?')) return null;
            ranks.push(rank.join('').replace(/1+/g, m => m.length));
        }
        return ranks.join('/');
    }

    // The fields after the board: seat to move, seats out, kingside and
    // queenside castling per seat, points, halfmove clock, then JSON
    function cvFields(fen) {
        let parts = fen.split('-');
        let json = {};
        try { json = JSON.parse(parts.slice(7).join('-')); } catch (e) {}
        let list = i => { try { return JSON.parse(parts[i]); } catch (e) { return []; } };
        return { turn: parts[1] === '2' ? 'b' : 'w', kingside: list(3), queenside: list(4), json };
    }

    // Standard castling rights a seat still has, for a king and rooks on their squares
    function cvCastling(placement, fields) {
        let rows = placement.split('/').map(r => r.replace(/\d/g, d => '1'.repeat(+d)));
        let rights = '';
        for (let [seat, row, k, r, K, Q] of [[0, 7, 'K', 'R', 'K', 'Q'], [2, 0, 'k', 'r', 'k', 'q']]) {
            if (rows[row][4] !== k) continue;
            if (fields.kingside[seat] && rows[row][7] === r) rights += K;
            if (fields.queenside[seat] && rows[row][0] === r) rights += Q;
        }
        return rights;
    }

    // Banked pieces, "rPx3" for three white pawns
    function cvBank(fields, letters) {
        let bank = fields.json.bank || [];
        let side = (seat, upper) => (bank[seat] || '').split(',').filter(Boolean).map(t => {
            let m = /^[a-z](.)(?:x(\d+))?$/u.exec(t);
            let letter = m ? (letters[m[1]] || m[1]) : '';
            return (upper ? letter.toUpperCase() : letter.toLowerCase()).repeat(+(m?.[2] || 1));
        }).join('');
        return side(0, true) + side(2, false);
    }

    // A game's start as a FEN in Fairy-Stockfish's notation: pockets in
    // brackets, remaining checks, Chess960 rook files, and the files of the
    // Seirawan pieces that may still bring a banked piece in
    function cvStartFen(slug, fen, letters) {
        let placement = placement8x8(fen, letters);
        if (!placement) return null;
        let f = cvFields(fen);
        let castling = slug === 'chess960' ? castling960(placement, placement)
            : slug === 'no-castling' || slug === 'setup-chess' ? '' : cvCastling(placement, f);
        let pockets = '';
        if (slug === 'crazyhouse') pockets = '[' + cvBank(f, letters) + ']';
        if (slug === 'seirawan-chess') {
            pockets = '[' + cvBank(f, letters) + ']';
            let gates = f.json.seirawanDrops || [];
            let files = (seat, upper) => (gates[seat] || []).map(sq => square8x8(sq)?.[0]).filter(c => c && !'aeh'.includes(c))
                .map(c => upper ? c.toUpperCase() : c).join('');
            castling = castling.replace(/[kq]/g, '') + files(0, true) + castling.replace(/[KQ]/g, '') + files(2, false);
        }
        let lives = f.json.lives || [3, 3, 3, 3];
        let checks = slug === '3-check' ? lives[0] + '+' + lives[2] + ' ' : '';
        return `${placement}${pockets} ${f.turn} ${castling || '-'} - ${checks}0 1`;
    }

    // One move as UCI. A drop names its piece ("@0_rP" from the bank); a duck
    // chess turn is the move, then where the duck goes; a Seirawan piece
    // brought in shows on the square its piece left in the position after. A
    // castle goes to the king's own square, though a live game's store has the
    // king going to its rook; a Chess960 castle stays king to rook.
    function cvUci(slug, move, letters) {
        let [from, to, promotion, duck, after, castle] = move;
        let target = square8x8(to);
        if (!target) return null;
        let drop = /^@\d_.(.)$/u.exec(from);
        if (drop) return (letters[drop[1]] || drop[1]).toUpperCase() + '@' + target;
        let source = square8x8(from);
        if (!source) return null;
        let rook = '';
        if (castle && slug !== 'chess960') {
            let kingside = target[0] > source[0];
            rook = (kingside ? 'h' : 'a') + source[1];
            target = (kingside ? 'g' : 'c') + source[1];
        }
        let uci = source + target + (promotion ? (letters[promotion] || promotion).toLowerCase() : '');
        if (duck) {
            let duckTo = square8x8(duck);
            return duckTo ? uci + ',' + target + duckTo : null;
        }
        if (slug === 'seirawan-chess' && after) {
            // a castle may bring the piece in on the rook's square, written rook to king
            let onKing = gatedAt(after, source, letters), onRook = rook && gatedAt(after, rook, letters);
            if (onKing) uci += onKing;
            else if (onRook) uci = rook + source + onRook;
        }
        return uci;
    }

    // The Seirawan piece, h or e, on a square of a position; '' for none
    function gatedAt(fen, square, letters) {
        let rows = placement8x8(fen, letters)?.split('/').map(r => r.replace(/\d/g, d => '1'.repeat(+d)));
        let piece = rows?.[8 - +square[1]]?.[square.charCodeAt(0) - 97];
        return piece && /^[HEhe]$/.test(piece) ? piece.toLowerCase() : '';
    }

    // A square of that grid on the 8x8 board: g4 is d1
    function square8x8(sq) {
        let m = /^([a-n])(\d+)$/.exec(sq);
        let file = m ? m[1].charCodeAt(0) - 100 : -1, rank = m ? +m[2] - 3 : 0;
        return file >= 0 && file < 8 && rank >= 1 && rank <= 8 ? String.fromCharCode(97 + file) + rank : null;
    }

    // The game a variants page shows, read from the page's store
    function variantsPageGame() {
        let nr = location.pathname.match(/^\/variants\/[^/]+\/game\/(\d+)/)?.[1];
        let g = nr && readVariantsGame();
        return g && String(g.gameNr) === nr ? g : null;
    }

    // The game a variants page shows, for the web app: its variant, its start
    // FEN, the FEN of the position now and its moves as UCI (a Chess960 castle
    // goes from the king to its rook, as the server writes it). Setup Chess
    // starts from the position its drops built, once both sides are done. Null
    // on other pages, for other variants and while the game loads.
    function variantsGame() {
        let slug = location.pathname.match(/^\/variants\/([^/]+)\//)?.[1];
        let variant = CV_RELAY[slug];
        let g = variant && variantsPageGame();
        if (!g) return null;
        let letters = CV_LETTERS[slug] || {};
        let start = g.startFen, moves = g.moves;
        if (slug === 'setup-chess') {
            let n = 0;
            while (n < moves.length && moves[n][0].startsWith('@')) n++;
            let done = n < moves.length || /"setupComplete":\[true,\w+,true/.test(moves[n - 1]?.[4] || '');
            if (!n || !done || !moves[n - 1][4]) return null;
            start = moves[n - 1][4];
            moves = moves.slice(n);
        }
        let startFen = cvStartFen(slug, start || '', letters);
        let fen = cvStartFen(slug, g.lastFen || start || '', letters);
        let ucis = moves.map(m => cvUci(slug, m, letters));
        if (!startFen || !fen || ucis.includes(null)) return null;
        return { variant, start: startFen, fen, ucis, over: g.gameOver, white: g.players[0] || '', black: g.players[2] || '' };
    }

    // The game to ask about, as { id, url, read }: read takes the response and
    // gives the start FEN, or null for a game that is not Chess960
    function game960() {
        if (SITE === 'lichess') {
            // lichess names the variant on the page, so other games need no lookup;
            // the analysis board, studies and broadcasts are not games
            if (!document.querySelector('.round__app.variant-chess960, main.analyse.variant-chess960')) return null;
            if (/^\/(analysis|study|broadcast)\b/.test(location.pathname)) return null;
            let id = location.pathname.match(/^\/(?:game\/)?(\w{8})/)?.[1];
            return id && {
                id,
                url: '/game/export/' + id + '?moves=false',
                read: r => r.text().then(pgn => pgn.match(/\[FEN "([^"]+)"\]/)?.[1] || null)
            };
        }
        // the variants server's games are not in chess.com's game API
        if (SITE === 'chesscom' && !location.pathname.startsWith('/variants/')) {
            let m = location.pathname.match(/\/game\/(?:(live|daily)\/)?(\d+)/);
            return m && {
                id: m[2],
                url: '/callback/' + (m[1] || 'live') + '/game/' + m[2],
                read: r => r.json().then(d => d?.game?.type === 'chess960' && d.game.initialSetup || null)
            };
        }
        return null;
    }

    // A few tries a few seconds apart, a minute after "too many requests";
    // a game that never answers is treated as standard chess
    const START960_TRIES = 3;
    const START960_RETRY_MS = 5000;
    const START960_BUSY_MS = 60000;
    let start960 = { id: '', fen: null, known: false, inFlight: false, tries: 0, retryAt: 0 };

    // The current game's Chess960 start FEN; null for other games and until it is known
    function chess960Start() {
        if (SITE === 'endgame') return egSecret.start960;
        if (SITE === 'chesscom' && location.pathname.startsWith('/variants/')) {
            let cv = variantsGame();
            return cv?.variant === 'chess960' ? cv.start : null;
        }
        let game = game960();
        if (!game) return null;
        if (start960.id !== game.id) start960 = { id: game.id, fen: null, known: false, inFlight: false, tries: 0, retryAt: 0 };
        let state = start960;
        if (!state.known && !state.inFlight && Date.now() >= state.retryAt) {
            state.inFlight = true;
            state.retryAt = Date.now() + START960_RETRY_MS;
            fetch(game.url)
                .then(r => {
                    if (r.status === 404) return null;
                    if (r.status === 429) state.retryAt = Date.now() + START960_BUSY_MS;
                    return r.ok ? game.read(r) : undefined;
                })
                .catch(() => undefined)
                .then(fen => {
                    if (fen !== undefined) state.fen = fen;
                    state.known = fen !== undefined || ++state.tries >= START960_TRIES;
                })
                .finally(() => { state.inFlight = false; });
        }
        return state.fen;
    }

    // --------------------------------------------------------------- analyzer

    function toggle(btn) {
        if (iv) {
            clearInterval(iv);
            iv = null;
            stopEngine();
            document.getElementById("sa-arrows")?.remove();
            btn.innerHTML = "Start Analyzer (Hotkey: A)";
            if (autoMoveEnabled) {
                toggleAutoMove();
            }
            return;
        }

        // A fresh start retries everything, including a model that gave up
        maiaFailed = false;
        maiaCrashed = false;
        maiaModelIdx = 0;
        maiaGen++;
        btn.innerHTML = "Stop Analyzer";
        moves = []; ponder = "";
        let fen = "", flipped = null;

        iv = setInterval(() => {
            let pos = readBoard();
            if (!pos) return;
            // a variant no engine here plays gets no arrows rather than wrong ones,
            // and so does a board still being set up
            if (pos.note) {
                let note = pos.note;
                if (fen !== note) {
                    fen = note;
                    idleEngine();
                    moves = []; ponder = "";
                    document.getElementById("sa-arrows")?.remove();
                    btn.innerHTML = note;
                }
                return;
            }
            ensureOverlay(pos.board);

            // Flipping keeps the FEN, so redraw for the new orientation without restarting the search.
            if (pos.flipped !== flipped) {
                flipped = pos.flipped;
                engineFlip = flipped;
                render(flipped);
            }

            // Chess960 castling rights come from the start position; pos.fen
            // itself stays as read, since the relay sends it on
            let rules = pos.rules || STANDARD;
            let start = rules.uci === 'chess' ? chess960Start() : null;
            let posFen = pos.fen;
            if (start) {
                let f = posFen.split(' ');
                f[2] = castling960(f[0], start);
                posFen = f.join(' ');
            }
            if (posFen === fen) return;

            fen = posFen;
            moves = []; ponder = "";
            render(pos.flipped);
            let playable = playableFen(fen, rules);
            if (playable) analyzeWorker(playable, pos.flipped, rules.uci, !!start);
            else idleEngine();
        }, 30);
    }

    // ------------------------------------------------------------------ relay
    // Mirrors the game to the Chess Analyzer web app (Live tab -> Session ID)

    let sessionId = localStorage.getItem(RELAY_KEY);
    if (!sessionId) {
        sessionId = Math.random().toString(36).slice(2, 10);
        localStorage.setItem(RELAY_KEY, sessionId);
    }
    let relayLastFen = "";
    let relayLastMoves = "";
    let relayMoveHistory = [];
    let relayGamePath = location.pathname;
    let relayEndSent = false;
    // the requests carrying the last position sent, which the end of the game waits for
    let relayPublished = Promise.resolve();
    // what the end of a variants-server game carries: its last position, in case that went astray
    let relayEndFields = {};
    const RELAY_END_WAIT_MS = 3000;
    let relayBoard = null;
    let relayQueued = false;
    const relayBoardObserver = new MutationObserver(queueRelayTick);

    function readPlayers(flipped) {
        let t = sel => document.querySelector(sel)?.textContent?.trim() || "";
        let bottom = "", top = "";
        if (SITE === 'chesscom') {
            bottom = t('.player-bottom [data-test-element="user-tagline-username"]') || t('.player-bottom .cc-user-username-component');
            top = t('.player-top [data-test-element="user-tagline-username"]') || t('.player-top .cc-user-username-component');
        } else if (SITE === 'endgame') {
            bottom = t('.widget-bottom-player .gp-username');
            top = t('.widget-top-player .gp-username');
        } else {
            bottom = (t('.ruser-bottom a.user-link') || t('.ruser-bottom')).split(/\s+/)[0] || "";
            top = (t('.ruser-top a.user-link') || t('.ruser-top')).split(/\s+/)[0] || "";
        }
        let bottomColor = flipped ? 'black' : 'white';
        return {
            white: bottomColor === 'white' ? bottom : top,
            black: bottomColor === 'white' ? top : bottom,
            bottom: bottomColor
        };
    }

    function isGameOver() {
        if (SITE === 'chesscom' && location.pathname.startsWith('/variants/')) return !!variantsPageGame()?.gameOver;
        if (SITE === 'chesscom') {
            return !!document.querySelector('.game-over-modal-content, .game-over-header-component, [class*="game-over-modal"]');
        }
        if (SITE === 'endgame') return !!document.querySelector('.finish-game-overlay');
        if (SITE === 'lichess' && (/^\/(training|streak|storm|racer)\b/.test(location.pathname) || document.querySelector('main.puzzle, .puzzle__board, .streak, .storm'))) {
            const wrap = document.querySelector('.cg-wrap');
            if (wrap && wrap.classList.contains('manipulable')) return false;
            return !!document.querySelector('.storm__game-over, .streak__game-over, .puzzle__feedback.fail');
        }
        return !!document.querySelector('.result-wrap, .round__app .status');
    }

    function readMovesCC() {
        const FIG = {
            '\u2659':'', '\u265f':'',
            '\u2658':'N','\u265e':'N',
            '\u2657':'B','\u265d':'B',
            '\u2656':'R','\u265c':'R',
            '\u2655':'Q','\u265b':'Q',
            '\u2654':'K','\u265a':'K'
        };
        const SAN_RE = /^(?:O-O(?:-O)?|[NBRQK][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8])(?:=[NBRQ])?[+#]?$/;

        function cleanSAN(tok) {
            return (tok || '')
                .replace(/[\u2654-\u265f]/g, c => FIG[c] ?? '')
                .replace(/0-0-0/gi, 'O-O-O')
                .replace(/0-0/gi,   'O-O')
                .replace(/^\d+\.(?:\.\.)?/, '')
                .replace(/[!?]+$/, '')
                .trim();
        }
        function isSAN(s) { return s && SAN_RE.test(s); }
        function textToMoves(text) {
            return String(text || '')
                .replace(/[\r\n\u00a0]+/g, ' ')
                .split(/\s+/)
                .map(cleanSAN)
                .filter(isSAN);
        }
        function nodesToMoves(nodes) {
            let arr = [];
            for (let n of nodes) {
                let raw = n.getAttribute?.('data-san') ||
                    n.getAttribute?.('data-move') ||
                    n.getAttribute?.('data-notation') ||
                    n.textContent || '';
                arr.push(...textToMoves(raw));
            }
            return arr;
        }

        // ── Strategy 1: JS property on wc-chess-board element ───────────────────
        // chess.com attaches its game object directly to the DOM element.
        // This is the most reliable approach and doesn't depend on DOM structure.
        try {
            let b = document.querySelector('.board-layout-main wc-chess-board') ||
                    document.querySelector('wc-chess-board');
            if (b) {
                let game = b.game || b._game;
                if (game) {
                    // chess.js-style history(), returns SAN array
                    if (typeof game.history === 'function') {
                        let h = game.history();
                        if (Array.isArray(h) && h.length > 0) {
                            console.log('[relay] moves via game.history():', h.length);
                            return h.slice(-256);
                        }
                    }
                    // Some versions expose moves as a list of objects
                    let rawMoves = game.moves || game.moveList || game.getMoves?.();
                    if (Array.isArray(rawMoves) && rawMoves.length > 0) {
                        let moves = rawMoves
                            .map(m => typeof m === 'string' ? cleanSAN(m) : cleanSAN(m.san || m.notation || ''))
                            .filter(isSAN);
                        if (moves.length > 0) {
                            console.log('[relay] moves via game.moves:', moves.length);
                            return moves.slice(-256);
                        }
                    }
                }
            }
        } catch(e) {}

        // ── Strategy 2: document-level querySelectorAll ──────────────────────────
        // Works for light DOM — tries specific chess.com class names.
        const docSelectors = [
            '.node-highlight-content',          // chess.com 2023+ move text
            '.move-text-component',             // older chess.com
            '[data-node-id] .move-text',
            '[data-node-id] span',
            'move .node-highlight-content',
            '.main-line-moves .node span',
            '.moves-list .node span',
            '.move-node .move-text',
            '[data-test-element*="move-list"] [data-ply]',
            '[data-ply][data-san]',
            '[data-ply] .move-san',
            'wc-simple-move-list [class*="move"]',
            'wc-chess-move-list [class*="move"]'
        ];
        for (let sel of docSelectors) {
            let nodes = document.querySelectorAll(sel);
            if (!nodes.length) continue;
            let moves = nodesToMoves(nodes);
            if (moves.length > 0) {
                console.log('[relay] moves via doc sel "' + sel + '":', moves.length);
                return moves.slice(-256);
            }
        }

        // ── Strategy 3: Move list container (light DOM + shadow DOM) ─────────────
        let root = document.querySelector(
            '.vertical-move-list-component,' +
            '.horizontal-move-list-component,' +
            '.move-list-component,' +
            '[class*="move-list"],' +
            '[data-test-element*="move-list"],' +
            'wc-simple-move-list,' +
            'wc-chess-move-list'
        );
        if (!root) {
            console.log('[relay] no move list root found');
            return [];
        }

        // Try shadow root first, then light DOM
        let roots = [root.shadowRoot, root].filter(Boolean);
        for (let sr of roots) {
            // Try individual nodes inside this root
            for (let sel of docSelectors) {
                let nodes = sr.querySelectorAll(sel);
                if (!nodes.length) continue;
                let moves = nodesToMoves(nodes);
                if (moves.length > 0) {
                    console.log('[relay] moves via sr sel "' + sel + '":', moves.length);
                    return moves.slice(-256);
                }
            }

            // ── Strategy 4: full text scraping of container ───────────────────────
            let text = (sr.innerText || sr.textContent || '')
                .replace(/[\u2654-\u265f]/g, c => FIG[c] ?? '')
                .replace(/0-0-0/gi, 'O-O-O')
                .replace(/0-0/gi,   'O-O')
                .replace(/\u00a0/g, ' ')
                .replace(/[\r\n]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!text) continue;

            let moves = textToMoves(text);
            if (moves.length > 0) {
                console.log('[relay] moves via text scrape, len:', (sr === root.shadowRoot ? 'shadow' : 'light'), moves.length);
                return moves.slice(-256);
            }
        }

        console.log('[relay] readMovesCC: no moves found. root tag:', root.tagName,
            'shadowRoot:', !!root.shadowRoot,
            'innerText len:', root.innerText?.length,
            'textContent len:', root.textContent?.length);
        return [];
    }

    // Resolves once every relay has answered or failed
    function publish(payload) {
        let body = JSON.stringify(payload);
        let requests = [];
        for (let base of RELAY_URLS) {
            if (hasGM) {
                requests.push(gmRequest({
                    method: 'POST',
                    url: base + sessionId,
                    data: body,
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
                }).catch(err => console.warn('relay publish failed', base, err)));
            } else {
                requests.push(fetch(base + sessionId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body
                }).catch(err => console.warn('relay publish failed', base, err)));
            }
        }
        return Promise.all(requests);
    }

    function keepFullRelayHistory(playedMoves) {
        let gamePath = location.pathname;
        if (gamePath !== relayGamePath || (relayEndSent && !isGameOver() && playedMoves.length <= 2)) {
            relayGamePath = gamePath;
            relayMoveHistory = [];
        }

        let isPrefix = playedMoves.every((move, index) => move === relayMoveHistory[index]);
        if (!isPrefix || playedMoves.length > relayMoveHistory.length) {
            relayMoveHistory = playedMoves;
        }
        return relayMoveHistory;
    }

    function publishRelayPosition(pos, force = false) {
        // a variants-server game goes as its variant, its start and its UCI moves
        let cv = SITE === 'chesscom' && location.pathname.startsWith('/variants/') ? variantsGame() : null;
        let playedMoves = SITE === 'chesscom' && !cv ? readMovesCC() : [];
        if (SITE === 'chesscom' && !cv) playedMoves = keepFullRelayHistory(playedMoves);
        let movesKey = (cv ? cv.ucis : playedMoves).join(' ');
        if (!force && pos.fen === relayLastFen && movesKey === relayLastMoves) return false;

        relayLastFen = pos.fen;
        relayLastMoves = movesKey;
        relayEndSent = false;
        let players = cv ? { white: cv.white, black: cv.black, bottom: pos.flipped ? 'black' : 'white' } : readPlayers(pos.flipped);
        // Lets the web app load the finished game from endgame.ai by id
        let gameId = SITE === 'endgame' ? location.pathname.match(/^\/game\/([\w-]+)/)?.[1] : undefined;
        // a variants game goes with the position its store has, which its board can misdraw
        let variantFields = cv ? { variant: cv.variant, startFen: cv.start, ucis: cv.ucis } : {};
        relayEndFields = cv ? { site: SITE, fen: cv.fen, ...variantFields, white: players.white, black: players.black, bottom: players.bottom } : {};
        relayPublished = publish({ v: 1, type: 'pos', site: SITE, gameId, fen: cv ? cv.fen : pos.fen, moves: playedMoves, ...variantFields, white: players.white, black: players.black, bottom: players.bottom, ts: Date.now() });
        return true;
    }

    // Variant games stay out of the relay, since the web app reads a board as
    // standard chess, except a variants-server game sent with its variant and
    // moves. That one goes even where this script has no engine for its
    // variant, and even where the page hides its board, as the narrow layout
    // does once the game is over.
    function readRelayBoard() {
        let pos = readBoard(true);
        if (!pos) return hiddenVariantsBoard();
        if (pos.note) return null;
        let rules = pos.rules || STANDARD;
        return rules === STANDARD || variantsGame() ? pos : null;
    }

    // A variants-server game whose board the page hides, read from its store
    function hiddenVariantsBoard() {
        let board = document.querySelector('.TheBoard-layers');
        if (!board || board.getBoundingClientRect().width) return null;
        let cv = variantsGame();
        if (!cv) return null;
        let flipped = document.querySelector('.playerbox-bottom [data-player]')?.dataset.player === '2';
        return { board, flipped, fen: cv.fen };
    }

    function refreshRelayMoves(fen) {
        let pos = readRelayBoard();
        if (!pos || pos.fen !== fen) return;
        if (publishRelayPosition(pos) && isGameOver()) sendRelayEnd();
    }

    // The end waits for the last position: sent together, the end could reach
    // the relay first, and the relay drops a message older than one it has. A
    // position sent while it waits replaces this end with the one after it.
    function sendRelayEnd() {
        if (relayEndSent) return;
        relayEndSent = true;
        let last = relayPublished;
        Promise.race([last, new Promise(r => setTimeout(r, RELAY_END_WAIT_MS))]).then(() => {
            if (relayEndSent && relayPublished === last) publish({ v: 1, type: 'end', ...relayEndFields, ts: Date.now() });
        });
    }

    function relayTick() {
        try {
            let pos = readRelayBoard();
            if (!pos) return;

            if (pos.board !== relayBoard) {
                relayBoardObserver.disconnect();
                relayBoard = pos.board;
                relayBoardObserver.observe(relayBoard, {
                    attributes: true,
                    childList: true,
                    subtree: true,
                    attributeFilter: ['class', 'style']
                });
            }

            let fenChanged = pos.fen !== relayLastFen;
            if (fenChanged) {
                publishRelayPosition(pos);
                if (SITE === 'chesscom') {
                    queueMicrotask(() => refreshRelayMoves(pos.fen));
                    setTimeout(() => refreshRelayMoves(pos.fen), 100);
                }
            }
            if (isGameOver()) sendRelayEnd();
        } catch (err) {
            console.warn('relay tick failed', err);
        }
    }

    function queueRelayTick() {
        if (relayQueued) return;
        relayQueued = true;
        queueMicrotask(() => {
            relayQueued = false;
            relayTick();
        });
    }

    new MutationObserver(queueRelayTick).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
    queueRelayTick();
    setInterval(() => {
        const pos = readRelayBoard();
        if (pos && !isGameOver()) publishRelayPosition(pos, true);
    }, 2000);

    // ---------------------------------------------------------------- auto move
    let autoMoveEnabled = false;
    let autoMoveTimer = null;
    let lastAutoMoveFen = null;
    let isMoving = false;
    let pendingMoveFen = null;

    function installInlineBridge() {
        if (document.getElementById('sa-bridge-tag')) return;
        try {
            const s = document.createElement('script');
            s.id = 'sa-bridge-tag';
            s.textContent = `(${function() {
                // Hook EventTarget on Lichess so synthetic mouse/touch events report isTrusted = true
                // Disable Chessground's isTrusted restriction on Lichess
                try {
                    const origDefine = Object.defineProperty;
                    Object.defineProperty = function(obj, prop, descriptor) {
                        if (prop === 'trustAllEvents' && descriptor) {
                            if ('value' in descriptor) descriptor.value = true;
                        }
                        return origDefine.apply(this, arguments);
                    };
                    origDefine(Object.prototype, 'trustAllEvents', {
                        get() { return true; },
                        set(v) {},
                        configurable: true
                    });
                } catch (e) {}

                // Hook WebSocket for Lichess
                let lichessSocket = null;
                const OrigWS = window.WebSocket;
                window.WebSocket = function(url, protocols) {
                    const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
                    const urlStr = String(url || '');
                    if (urlStr.includes('lichess') || urlStr.includes('/play/') || urlStr.includes('/round/') || urlStr.includes('/watch/')) {
                        lichessSocket = ws;
                        window.__saLichessWS = ws;
                    }
                    return ws;
                };
                window.WebSocket.prototype = OrigWS.prototype;

                function isCastlingMatch(m, from, to) {
                    if (!m) return false;
                    if (m.from === from && m.to === to) return true;
                    const isKingMove = from === 'e1' || from === 'e8' || m.piece === 'k';
                    const isCastleSan = m.san === 'O-O' || m.san === 'O-O-O';
                    const isCastleTarget = ['g1', 'c1', 'g8', 'c8', 'h1', 'a1', 'h8', 'a8'].includes(to);
                    if (isKingMove && isCastleSan && isCastleTarget) return true;
                    return false;
                }

                function isDropMatch(m, from, to) {
                    if (!m || !from.includes('@')) return false;
                    const dropRole = from[0].toLowerCase();
                    return (m.dropPiece && m.dropPiece.toLowerCase() === dropRole && m.to === to) ||
                           (m.from && m.from.toLowerCase() === (dropRole + '@') && m.to === to);
                }

                function makeChessComMove(from, to, promo, duckTo) {
                    const board = document.querySelector('wc-chess-board') || document.querySelector('chess-board');
                    if (!board) return false;
                    const game = board.game || board._game;
                    if (!game) return false;
                    if (typeof game.getLegalMoves === 'function' && typeof game.move === 'function') {
                        try {
                            const legal = game.getLegalMoves();
                            for (let i = 0; i < legal.length; i++) {
                                const m = legal[i];
                                if (isCastlingMatch(m, from, to) || isDropMatch(m, from, to)) {
                                    const moveObj = Object.assign({}, m, { animate: true, userGenerated: true });
                                    if (m.promotion || promo) {
                                        moveObj.promotion = (promo || 'q').toLowerCase();
                                    }
                                    if (duckTo) {
                                        moveObj.duck = duckTo;
                                    }
                                    game.move(moveObj);
                                    return true;
                                }
                            }
                        } catch (err) {}
                    }
                    if (typeof game.userMove === 'function') {
                        try {
                            const res = game.userMove(from, to, promo ? promo.toLowerCase() : undefined);
                            if (res) return true;
                        } catch (e) {}
                    }
                    return false;
                }

                function makeLichessMove(from, to, promo, explicitUci) {
                    const uci = explicitUci || (from.includes('@') ? (from[0].toUpperCase() + '@' + to) : (from + to + (promo ? promo.toLowerCase() : '')));
                    const isDrop = uci.includes('@') || from.includes('@');
                    const isPuzzle = /^\/(training|streak|storm|racer)\b/.test(location.pathname) ||
                                     !!document.querySelector('main.puzzle, .puzzle__board, [class*="puzzle"], .streak, .storm, .racer') ||
                                     !!window.lichess?.puzzle;

                    // In Puzzles:
                    if (isPuzzle) {
                        try {
                            if (window.lichess?.puzzle?.playUci && typeof window.lichess.puzzle.playUci === 'function') {
                                window.lichess.puzzle.playUci(uci);
                                return true;
                            }
                        } catch (e) {}
                        try {
                            if (window.lichess?.analysis?.playUci && typeof window.lichess.analysis.playUci === 'function') {
                                window.lichess.analysis.playUci(uci);
                                return true;
                            }
                        } catch (e) {}
                        if (!isDrop) {
                            try {
                                const cg = window.lichess?.chessground || window.lichess?.round?.chessground || window.lichess?.analysis?.chessground;
                                if (cg) {
                                    if (typeof cg.userMove === 'function') { cg.userMove(from, to); return true; }
                                    if (typeof cg.move === 'function') { cg.move(from, to); return true; }
                                }
                            } catch (e) {}
                        }
                        return false;
                    }

                    // Priority 1: Live Game WebSocket (Crazyhouse, Bullet, Blitz, Standard)
                    try {
                        if (window.lichess?.socket?.send) {
                            window.lichess.socket.send('move', { u: uci, b: 1 });
                            return true;
                        }
                    } catch (e) {}
                    const ws = window.__saLichessWS || lichessSocket;
                    if (ws && ws.readyState === 1) {
                        try {
                            ws.send(JSON.stringify({ t: 'move', d: { u: uci, b: 1 } }));
                            return true;
                        } catch (err) {}
                    }
                    try {
                        if (window.site?.socket?.send) {
                            window.site.socket.send('move', { u: uci, b: 1 });
                            return true;
                        }
                    } catch (e) {}

                    // Priority 3: Chessground userMove (Only if not a drop move)
                    if (!isDrop) {
                        try {
                            const cg = window.lichess?.chessground || window.lichess?.round?.chessground || window.lichess?.analysis?.chessground;
                            if (cg) {
                                if (typeof cg.userMove === 'function') { cg.userMove(from, to); return true; }
                                if (typeof cg.move === 'function') { cg.move(from, to); return true; }
                            }
                        } catch (e) {}
                    }

                    return false;
                }

                function tryPageBridgePromotion(promo) {
                    const p = (promo || 'q').toLowerCase();
                    try {
                        const board = document.querySelector('wc-chess-board') || document.querySelector('chess-board');
                        if (board && board.game) {
                            const g = board.game;
                            if (typeof g.promote === 'function') { g.promote(p); return true; }
                            if (typeof g.onPromotionPiece === 'function') { g.onPromotionPiece(p); return true; }
                            if (typeof g.selectPromotionPiece === 'function') { g.selectPromotionPiece(p); return true; }
                            if (typeof g.setPromotionPiece === 'function') { g.setPromotionPiece(p); return true; }
                            if (typeof g.resolvePromotion === 'function') { g.resolvePromotion(p); return true; }
                            for (const k in g) {
                                if (typeof g[k] === 'function' && /promo/i.test(k)) {
                                    try { g[k](p); return true; } catch (err) {}
                                }
                            }
                        }
                    } catch (e) {}
                    return false;
                }

                window.addEventListener('sa-page-promote', function(e) {
                    const promo = e.detail?.promo || 'q';
                    tryPageBridgePromotion(promo);
                });

                window.addEventListener('sa-page-move', function(e) {
                    const { from, to, promo, duckTo, uci } = e.detail || {};
                    if (!from || !to) return;
                    let ok = false;
                    if (location.hostname.includes('lichess')) {
                        ok = makeLichessMove(from, to, promo, uci);
                    } else {
                        ok = makeChessComMove(from, to, promo, duckTo);
                    }
                    window.dispatchEvent(new CustomEvent('sa-page-move-ack', { detail: { ok, from, to } }));
                });
            }})();`;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        } catch (e) {}
    }
    installInlineBridge();

    function getSquareCoords(b, sq, flipped) {
        if (!b || !sq || sq.length < 2) return null;
        const rect = b.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return null;
        const sqWidth = rect.width / 8;
        const sqHeight = rect.height / 8;
        const fileIdx = 'abcdefgh'.indexOf(sq[0].toLowerCase());
        const rankIdx = parseInt(sq[1], 10) - 1;
        if (fileIdx < 0 || rankIdx < 0 || rankIdx > 7) return null;

        let x, y;
        if (flipped) {
            x = rect.left + (7 - fileIdx + 0.5) * sqWidth;
            y = rect.top + (rankIdx + 0.5) * sqHeight;
        } else {
            x = rect.left + (fileIdx + 0.5) * sqWidth;
            y = rect.top + (7 - rankIdx + 0.5) * sqHeight;
        }
        return { x, y };
    }

    function findGeometricPromotionTarget(b, p) {
        if (!b) b = document.querySelector('wc-chess-board, cg-board, .board, .board-container .board') || document.body;
        const bRect = b.getBoundingClientRect();
        if (!bRect || bRect.width === 0) return null;

        const sqSize = bRect.width / 8;
        const allDivs = document.querySelectorAll('div, section, aside, form');
        const roleIdx = { q: 0, r: 1, b: 2, n: 3 }[p] ?? 0;

        for (const el of allDivs) {
            if (el === b || el === document.body || el.id === 'sa-wrap' || el.id === 'sa-arrows') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            const inBoard = rect.left >= bRect.left - 20 && rect.right <= bRect.right + 20 &&
                            rect.top >= bRect.top - 20 && rect.bottom <= bRect.bottom + 20;
            if (!inBoard) continue;

            const ratioV = rect.height / rect.width;
            const ratioH = rect.width / rect.height;

            // Vertical 4-piece column (e.g. over promotion square on Chess.com / Endgame.ai)
            if (ratioV >= 2.0 && ratioV <= 6.5 && rect.width < sqSize * 1.8 && rect.height > sqSize * 1.8) {
                const isTop = (rect.top - bRect.top) < (bRect.bottom - rect.bottom);
                const targetX = rect.left + rect.width / 2;
                const fraction = isTop ? (roleIdx * 0.25 + 0.125) : ((3 - roleIdx) * 0.25 + 0.125);
                const targetY = rect.top + rect.height * fraction;
                return { x: targetX, y: targetY, el };
            }

            // Horizontal 4-piece row
            if (ratioH >= 2.0 && ratioH <= 6.5 && rect.height < sqSize * 1.8 && rect.width > sqSize * 1.8) {
                const targetY = rect.top + rect.height / 2;
                const targetX = rect.left + rect.width * (roleIdx * 0.25 + 0.125);
                return { x: targetX, y: targetY, el };
            }
        }
        return null;
    }

    function hasPromotionModal() {
        if (SITE === 'chesscom') {
            return !!document.querySelector('.promotion-window, [class*="promotion-window"], .promotion-menu');
        }
        if (SITE === 'endgame') {
            return !!document.querySelector('.turn-into-selection, [class*="turn-into"]');
        }
        if (SITE === 'lichess') {
            return !!document.querySelector('#promotion-choice, #promotion_choice, .promotion-choice, square.promotion');
        }
        return false;
    }

    function handlePromotion(promo) {
        if (!hasPromotionModal()) return false;

        const p = (promo || 'q').toLowerCase();
        const roleIdx = { q: 0, r: 1, b: 2, n: 3 }[p] ?? 0;
        const liName = { q: 'queen', n: 'knight', r: 'rook', b: 'bishop' }[p] || 'queen';

        // 0. Trigger controller in MAIN world page-bridge
        try {
            window.dispatchEvent(new CustomEvent('sa-page-promote', { detail: { promo: p } }));
        } catch (e) {}

        const fireFullClick = (el) => {
            if (!el) return false;
            try { el.click(); } catch (e) {}
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
            try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
            try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
            try { el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 })); } catch (e) {}
            try { el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 })); } catch (e) {}
            try { el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 })); } catch (e) {}
            try { el.click(); } catch (e) {}
            return true;
        };

        // Platform 1: Endgame.ai Vue.js modal (.turn-into-selection)
        if (SITE === 'endgame') {
            const egSelection = document.querySelector('.turn-into-selection, [class*="turn-into"]');
            if (egSelection) {
                const children = Array.from(egSelection.children).filter(c => c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT');
                if (children.length >= 4) {
                    const target = children[roleIdx];
                    if (target) {
                        console.log('[AutoMove EG] .turn-into-selection child found, clicking index:', roleIdx, target);
                        fireFullClick(target);
                        const inner = target.querySelector('.piece, div, img, svg') || target;
                        if (inner && inner !== target) {
                            try { inner.click(); } catch (e) {}
                            try { inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window })); } catch (e) {}
                        }
                        return true;
                    }
                }
            }
            return false;
        }

        // Platform 2: Chess.com (.promotion-window)
        if (SITE === 'chesscom') {
            const win = document.querySelector('.promotion-window, [class*="promotion-window"], .promotion-menu');
            if (win) {
                const targetPiece = win.querySelector(`.promotion-piece.w${p}, .promotion-piece.b${p}, .promotion-piece.${p}`) ||
                                    win.children[roleIdx] || win.firstElementChild;
                if (targetPiece) {
                    console.log('[AutoMove CC] Clicking promotion piece:', targetPiece);
                    fireFullClick(targetPiece);
                    return true;
                }
            }
            return false;
        }

        // Platform 3: Lichess (#promotion-choice)
        if (SITE === 'lichess') {
            const target = document.querySelector(`#promotion-choice .${liName}, #promotion_choice .${liName}, square.promotion .${liName}, #promotion-choice square:nth-child(${roleIdx + 1})`);
            if (target) {
                console.log('[AutoMove LI] Clicking promotion choice:', target);
                fireFullClick(target);
                return true;
            }
            return false;
        }

        return false;
    }

    async function waitForAndPromote(promo) {
        const p = (promo || 'q').toLowerCase();
        for (let i = 0; i < 30; i++) {
            if (handlePromotion(p)) return true;
            await new Promise(r => setTimeout(r, 40));
        }
        return false;
    }

    let lastSecretQueenAttempt = 0;
    function autoSelectSecretQueen(flipped) {
        if (SITE !== 'endgame' || egSecret.secret !== true || egSecret.ownSquare) return;
        if (Date.now() - lastSecretQueenAttempt < 2500) return;

        const bestSquare = flipped ? 'd7' : 'd2';
        const cell = document.querySelector(`.cell#${bestSquare}`);
        if (cell && !cell.querySelector('.secret-queen-badge')) {
            lastSecretQueenAttempt = Date.now();
            const piece = cell.querySelector('.piece') || cell;
            console.log('[AutoMove EG] Auto-selecting Secret Queen once on:', bestSquare);
            const r = piece.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
            piece.dispatchEvent(new PointerEvent('pointerdown', opts));
            piece.dispatchEvent(new MouseEvent('mousedown', opts));
            setTimeout(() => {
                piece.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
                piece.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
                piece.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
                try { piece.click(); } catch (e) {}
                try { cell.click(); } catch (e) {}
            }, 30);
        }
    }

    async function makeEndgameMove(from, to, promo, b) {
        const fromCell = b.querySelector(`.cell#${from}`) || document.querySelector(`.cell#${from}`);
        const toCell = b.querySelector(`.cell#${to}`) || document.querySelector(`.cell#${to}`);
        if (!fromCell || !toCell) {
            console.warn('[AutoMove EG] Cells not found:', from, to);
            return false;
        }

        const fromPiece = fromCell.querySelector('.piece') || fromCell;
        const toPiece = toCell.querySelector('.piece') || toCell;

        const r1 = fromPiece.getBoundingClientRect();
        const r2 = toCell.getBoundingClientRect();
        const x1 = r1.left + r1.width / 2;
        const y1 = r1.top + r1.height / 2;
        const x2 = r2.left + r2.width / 2;
        const y2 = r2.top + r2.height / 2;

        const makeEvt = (type, x, y, buttons) => new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: x, clientY: y, screenX: x, screenY: y,
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: buttons
        });

        // 1. Click-to-move sequence on From
        fromPiece.dispatchEvent(makeEvt('pointerdown', x1, y1, 1));
        fromPiece.dispatchEvent(makeEvt('mousedown', x1, y1, 1));
        fromCell.dispatchEvent(makeEvt('pointerdown', x1, y1, 1));
        fromCell.dispatchEvent(makeEvt('mousedown', x1, y1, 1));

        await new Promise(r => setTimeout(r, 20));

        fromPiece.dispatchEvent(makeEvt('pointerup', x1, y1, 0));
        fromPiece.dispatchEvent(makeEvt('mouseup', x1, y1, 0));
        fromPiece.dispatchEvent(makeEvt('click', x1, y1, 0));
        fromCell.dispatchEvent(makeEvt('pointerup', x1, y1, 0));
        fromCell.dispatchEvent(makeEvt('mouseup', x1, y1, 0));
        fromCell.dispatchEvent(makeEvt('click', x1, y1, 0));
        try { fromPiece.click(); } catch(e) {}
        try { fromCell.click(); } catch(e) {}

        await new Promise(r => setTimeout(r, 60));

        // 2. Click-to-move sequence on To
        toPiece.dispatchEvent(makeEvt('pointerdown', x2, y2, 1));
        toPiece.dispatchEvent(makeEvt('mousedown', x2, y2, 1));
        toCell.dispatchEvent(makeEvt('pointerdown', x2, y2, 1));
        toCell.dispatchEvent(makeEvt('mousedown', x2, y2, 1));

        await new Promise(r => setTimeout(r, 20));

        toPiece.dispatchEvent(makeEvt('pointerup', x2, y2, 0));
        toPiece.dispatchEvent(makeEvt('mouseup', x2, y2, 0));
        toPiece.dispatchEvent(makeEvt('click', x2, y2, 0));
        toCell.dispatchEvent(makeEvt('pointerup', x2, y2, 0));
        toCell.dispatchEvent(makeEvt('mouseup', x2, y2, 0));
        toCell.dispatchEvent(makeEvt('click', x2, y2, 0));
        try { toPiece.click(); } catch(e) {}
        try { toCell.click(); } catch(e) {}

        // 3. Drag sequence (pointermove) in case board requires drag
        await new Promise(r => setTimeout(r, 40));
        const stillThere = fromCell.querySelector('.piece');
        if (stillThere) {
            fromPiece.dispatchEvent(makeEvt('pointerdown', x1, y1, 1));
            fromPiece.dispatchEvent(makeEvt('mousedown', x1, y1, 1));
            await new Promise(r => setTimeout(r, 20));

            for (let i = 1; i <= 3; i++) {
                const t = i / 3;
                const cx = x1 + (x2 - x1) * t;
                const cy = y1 + (y2 - y1) * t;
                window.dispatchEvent(makeEvt('pointermove', cx, cy, 1));
                window.dispatchEvent(makeEvt('mousemove', cx, cy, 1));
                await new Promise(r => setTimeout(r, 10));
            }

            toCell.dispatchEvent(makeEvt('pointerup', x2, y2, 0));
            toCell.dispatchEvent(makeEvt('mouseup', x2, y2, 0));
            toCell.dispatchEvent(makeEvt('click', x2, y2, 0));

            // HTML5 Drag
            try {
                const dt = new DataTransfer();
                fromPiece.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x1, clientY: y1 }));
                toCell.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x2, clientY: y2 }));
                toCell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x2, clientY: y2 }));
                toCell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x2, clientY: y2 }));
                fromPiece.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x2, clientY: y2 }));
            } catch (e) {}
        }

        // 4. WebSocket SignalR backup
        window.dispatchEvent(new CustomEvent('sa-endgame-ws-send', { detail: { from, to, promo } }));

        const isPromotion = promo !== null || ((from[1] === '7' && to[1] === '8') || (from[1] === '2' && to[1] === '1'));
        if (isPromotion) {
            await waitForAndPromote(promo || 'q');
        }

        return true;
    }

    async function makeLichessMoveDOM(from, to, promo, b, flipped, isDrop) {
        const toCoord = getSquareCoords(b, to, flipped);
        if (!toCoord) return false;

        const makeMouseEvt = (type, x, y, buttons) => new MouseEvent(type, {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: buttons
        });

        if (isDrop) {
            const role = from[0].toLowerCase();
            const roleName = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }[role] || 'pawn';
            const myColor = flipped ? 'b' : 'w';

            // Find player's pocket at bottom of screen
            const playerPocket = document.querySelector('.pocket.is2d.pocket-bottom.usable, .pocket.is2d.pocket-bottom, .pocket-bottom, [class*="pocket-bot"]');
            let pocketPiece = null;

            if (playerPocket) {
                // Specifically query <piece> elements inside the pocket
                const candidates = playerPocket.querySelectorAll(`piece[data-role="${roleName}"], piece.${roleName}, [data-role="${roleName}"]`);
                for (const p of candidates) {
                    const count = parseInt(p.getAttribute('data-nb') || p.dataset.nb || '0', 10);
                    if (count > 0) {
                        pocketPiece = p;
                        break;
                    }
                }
                if (!pocketPiece) {
                    for (const p of playerPocket.querySelectorAll('piece')) {
                        const r = p.getAttribute('data-role') || '';
                        const cls = p.className || '';
                        const count = parseInt(p.getAttribute('data-nb') || '0', 10);
                        if ((r === roleName || cls.includes(roleName)) && count > 0) {
                            pocketPiece = p;
                            break;
                        }
                    }
                }
            }

            console.log('[AutoMove Lichess Crazyhouse] Target drop piece:', pocketPiece, 'role:', roleName, 'to:', to);

            if (pocketPiece) {
                const r = pocketPiece.getBoundingClientRect();
                const px = r.left + r.width / 2;
                const py = r.top + r.height / 2;

                // 1. Mouse down on the <piece> element (bubbles to div.pocket triggering drag(ctrl, e))
                pocketPiece.dispatchEvent(makeMouseEvt('mousedown', px, py, 1));
                if (playerPocket) playerPocket.dispatchEvent(makeMouseEvt('mousedown', px, py, 1));

                await new Promise(res => setTimeout(res, 25));

                // 2. Mouse move towards destination square
                const midX = px + (toCoord.x - px) * 0.3;
                const midY = py + (toCoord.y - py) * 0.3;
                document.dispatchEvent(makeMouseEvt('mousemove', midX, midY, 1));

                await new Promise(res => setTimeout(res, 25));

                // 3. Mouse move to exact destination square on board
                document.dispatchEvent(makeMouseEvt('mousemove', toCoord.x, toCoord.y, 1));

                await new Promise(res => setTimeout(res, 25));

                // 4. Mouse up on destination square to complete drop
                document.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));
                b.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));

                // 5. Click on target square as fallback
                await new Promise(res => setTimeout(res, 40));
                b.dispatchEvent(makeMouseEvt('mousedown', toCoord.x, toCoord.y, 1));
                b.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));
                try {
                    const toEl = document.elementFromPoint(toCoord.x, toCoord.y);
                    if (toEl) toEl.click();
                } catch (e) {}

                return true;
            }

            return true;
        }

        const fromCoord = getSquareCoords(b, from, flipped);
        if (!fromCoord) return false;

        // 1. Mouse down on from square (both on piece and on board)
        const fromEl = document.elementFromPoint(fromCoord.x, fromCoord.y) || b;
        fromEl.dispatchEvent(makeMouseEvt('mousedown', fromCoord.x, fromCoord.y, 1));
        b.dispatchEvent(makeMouseEvt('mousedown', fromCoord.x, fromCoord.y, 1));

        await new Promise(r => setTimeout(r, 20));

        // 2. Mouse move on document to exceed Chessground's drag threshold (>3px)
        const midX = fromCoord.x + (toCoord.x - fromCoord.x) * 0.25;
        const midY = fromCoord.y + (toCoord.y - fromCoord.y) * 0.25;
        document.dispatchEvent(makeMouseEvt('mousemove', midX, midY, 1));

        await new Promise(r => setTimeout(r, 20));

        // 3. Mouse move to destination square
        document.dispatchEvent(makeMouseEvt('mousemove', toCoord.x, toCoord.y, 1));

        await new Promise(r => setTimeout(r, 20));

        // 4. Mouse up on document (where Chessground binds end handler) and on to square
        const toEl = document.elementFromPoint(toCoord.x, toCoord.y) || b;
        document.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));
        b.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));
        toEl.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));

        // 5. Dual fallback: click-to-move sequence
        await new Promise(r => setTimeout(r, 30));
        b.dispatchEvent(makeMouseEvt('mousedown', toCoord.x, toCoord.y, 1));
        b.dispatchEvent(makeMouseEvt('mouseup', toCoord.x, toCoord.y, 0));
        try { toEl.click(); } catch (e) {}

        const isPromotion = promo !== null || ((from[1] === '7' && to[1] === '8') || (from[1] === '2' && to[1] === '1'));
        if (isPromotion) {
            await waitForAndPromote(promo || 'q');
        }

        return true;
    }

    async function executeMove(moveStr, b, flipped, ackPromise) {
        if (!moveStr || moveStr.length < 4 || !b) return false;

        const isDrop = moveStr.includes('@');
        let from, to;
        if (isDrop) {
            from = moveStr.slice(0, 2);
            to = moveStr.slice(2, 4).toLowerCase();
        } else {
            from = moveStr.slice(0, 2).toLowerCase();
            to = moveStr.slice(2, 4).toLowerCase();
        }
        const promo = (!isDrop && moveStr.length > 4 && !moveStr.includes(',')) ? moveStr[4].toLowerCase() : null;

        // Duck chess: e.g. "e2e4,c3" or "e2e4,e4c3"
        const duckMatch = moveStr.match(/,[a-h]?[1-8]?([a-h][1-8])$/);
        const duckTo = duckMatch ? duckMatch[1].toLowerCase() : null;

        const uci = isDrop ? (moveStr[0].toUpperCase() + '@' + to) : (from + to + (promo ? promo.toLowerCase() : ''));

        console.log(`[AutoMove] Attempting: ${from} -> ${to}${promo ? ' (' + promo + ')' : ''}${duckTo ? ' [Duck: ' + duckTo + ']' : ''}`);

        // Platform-specific: Endgame.ai
        if (SITE === 'endgame') {
            const moved = await makeEndgameMove(from, to, promo, b);
            return moved;
        }

        // Platform-specific: Lichess
        if (SITE === 'lichess') {
            window.dispatchEvent(new CustomEvent('sa-page-move', { detail: { from, to, promo, uci } }));
            const moved = await makeLichessMoveDOM(from, to, promo, b, flipped, isDrop);
            return moved;
        }

        // Method 1: Page-bridge (runs in MAIN world with direct board.game access)
        window.dispatchEvent(new CustomEvent('sa-page-move', { detail: { from, to, promo, duckTo, uci } }));
        if (ackPromise) {
            const ok = await ackPromise;
            if (ok) {
                console.log(`[AutoMove] Move executed via page-bridge: ${from}${to}`);
                return true;
            }
        }

        // Method 2: Physical drag-and-drop pointer & mouse emulation
        const toCoord = getSquareCoords(b, to, flipped);
        if (!toCoord) return false;

        let fromEl = null;
        let toEl = null;
        let fromCoord = null;

        if (isDrop) {
            const role = moveStr[0].toLowerCase();
            const roleName = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' }[role] || 'pawn';
            const myColor = flipped ? 'b' : 'w';

            // Find piece with count > 0 in the player's usable pocket
            const usablePockets = [
                document.querySelector('.pocket.usable'),
                document.querySelector(flipped ? '.pocket.bottom, .pocket:not(.top)' : '.pocket.bottom, .pocket:not(.top)'),
                document.querySelector(`.pocket.${myColor === 'w' ? 'white' : 'black'}`),
                document.querySelector(`.crazyhouse-pocket.bottom, .crazyhouse-pocket.${myColor === 'w' ? 'white' : 'black'}`),
                document.querySelector('.crazyhouse-pocket, .pocket-row')
            ].filter(Boolean);

            for (const pocket of usablePockets) {
                const candidates = pocket.querySelectorAll('piece, [data-role], .piece, div');
                for (const p of candidates) {
                    const cls = p.className || '';
                    const matchRole = cls.includes(roleName) || cls.includes(role) || p.dataset.role === roleName || p.dataset.role === role;
                    const count = parseInt(p.dataset.nb || p.getAttribute('data-nb') || '1', 10);
                    if (matchRole && count > 0) {
                        fromEl = p;
                        break;
                    }
                }
                if (fromEl) break;
            }

            // Fallback: search all pieces with count > 0
            if (!fromEl) {
                const all = document.querySelectorAll('.pocket piece, .pocket [data-role], [class*="pocket"] [class*="piece"]');
                for (const p of all) {
                    const cls = p.className || '';
                    const count = parseInt(p.dataset.nb || '1', 10);
                    if ((cls.includes(roleName) || cls.includes(role)) && count > 0) {
                        fromEl = p;
                        break;
                    }
                }
            }

            if (fromEl) {
                const r = fromEl.getBoundingClientRect();
                fromCoord = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
        } else {
            fromCoord = getSquareCoords(b, from, flipped);
            if (SITE === 'chesscom') {
                const fNum = 'abcdefgh'.indexOf(from[0]) + 1;
                fromEl = b.querySelector(`.piece.square-${fNum}${from[1]}`);
            }
        }
        if (!fromCoord) return false;

        if (SITE === 'chesscom') {
            const tNum = 'abcdefgh'.indexOf(to[0]) + 1;
            toEl = b.querySelector(`.hint.square-${tNum}${to[1]}`) ||
                   b.querySelector(`.capture-hint.square-${tNum}${to[1]}`) ||
                   b.querySelector(`.piece.square-${tNum}${to[1]}`);
        }

        const startEl = fromEl || document.elementFromPoint(fromCoord.x, fromCoord.y) || b;
        
        // Pointer down
        const downEvt = {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: fromCoord.x, clientY: fromCoord.y, screenX: fromCoord.x, screenY: fromCoord.y,
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1
        };
        startEl.dispatchEvent(new PointerEvent('pointerdown', downEvt));
        startEl.dispatchEvent(new MouseEvent('mousedown', downEvt));

        await new Promise(r => setTimeout(r, 25));

        // Drag move in 3 interpolated steps
        for (let i = 1; i <= 3; i++) {
            const t = i / 3;
            const curX = fromCoord.x + (toCoord.x - fromCoord.x) * t;
            const curY = fromCoord.y + (toCoord.y - fromCoord.y) * t;
            const moveEvt = {
                bubbles: true, cancelable: true, composed: true, view: window,
                clientX: curX, clientY: curY, screenX: curX, screenY: curY,
                pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1
            };
            window.dispatchEvent(new PointerEvent('pointermove', moveEvt));
            window.dispatchEvent(new MouseEvent('mousemove', moveEvt));
            await new Promise(r => setTimeout(r, 15));
        }

        const endEl = toEl || document.elementFromPoint(toCoord.x, toCoord.y) || b;
        const upEvt = {
            bubbles: true, cancelable: true, composed: true, view: window,
            clientX: toCoord.x, clientY: toCoord.y, screenX: toCoord.x, screenY: toCoord.y,
            pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0
        };
        endEl.dispatchEvent(new PointerEvent('pointerup', upEvt));
        endEl.dispatchEvent(new MouseEvent('mouseup', upEvt));
        endEl.dispatchEvent(new MouseEvent('click', upEvt));

        // Fallback: Click-to-move
        await new Promise(r => setTimeout(r, 40));
        startEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: fromCoord.x, clientY: fromCoord.y }));
        await new Promise(r => setTimeout(r, 60));
        endEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: toCoord.x, clientY: toCoord.y }));

        const isPromotion = promo !== null || (!isDrop && ((from[1] === '7' && to[1] === '8') || (from[1] === '2' && to[1] === '1')));
        if (isPromotion) {
            waitForAndPromote(promo || 'q');
        }

        if (duckTo) {
            await new Promise(r => setTimeout(r, 120));
            const duckCoord = getSquareCoords(b, duckTo, flipped);
            if (duckCoord) {
                const duckTarget = document.elementFromPoint(duckCoord.x, duckCoord.y) || b;
                const dOpts = {
                    bubbles: true, cancelable: true, composed: true, view: window,
                    clientX: duckCoord.x, clientY: duckCoord.y,
                    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1
                };
                duckTarget.dispatchEvent(new PointerEvent('pointerdown', dOpts));
                duckTarget.dispatchEvent(new MouseEvent('mousedown', dOpts));
                duckTarget.dispatchEvent(new PointerEvent('pointerup', { ...dOpts, buttons: 0 }));
                duckTarget.dispatchEvent(new MouseEvent('mouseup', { ...dOpts, buttons: 0 }));
                duckTarget.dispatchEvent(new MouseEvent('click', { ...dOpts, buttons: 0 }));
            }
        }

        return true;
    }

    function tickAutoMove() {
        if (!autoMoveEnabled || isMoving) return;
        if (SITE === 'endgame' && egSecret.secret === true && !egSecret.ownSquare) {
            autoSelectSecretQueen(lastEGFlipped);
        }
        if (isGameOver()) {
            if (autoMoveTimer) { clearTimeout(autoMoveTimer); autoMoveTimer = null; }
            pendingMoveFen = null;
            return;
        }

        const pos = readBoard();
        if (!pos || !pos.fen || pos.note) return;

        const fenParts = pos.fen.split(' ');
        const turn = fenParts[1] || currentTurn;
        const myColor = pos.flipped ? 'b' : 'w';

        const isPuzzle = SITE === 'lichess' && (/^\/(training|streak|storm|racer)\b/.test(location.pathname) || !!document.querySelector('main.puzzle, .puzzle__board, [class*="puzzle"], .streak, .storm, .racer'));

        // Opponent's turn -> clear pending timer (in puzzles, player always solves for active turn)
        if (!isPuzzle && turn !== myColor) {
            if (autoMoveTimer) {
                clearTimeout(autoMoveTimer);
                autoMoveTimer = null;
                pendingMoveFen = null;
            }
            return;
        }

        // Our turn! Check position placement
        const boardPlacement = fenParts[0] + ' ' + fenParts[1];
        if (lastAutoMoveFen === boardPlacement) return;
        if (autoMoveTimer !== null && pendingMoveFen === boardPlacement) return;

        if (autoMoveTimer !== null && pendingMoveFen !== boardPlacement) {
            clearTimeout(autoMoveTimer);
            autoMoveTimer = null;
        }

        // 0.5 - 1.0 second delay (500ms - 1000ms)
        const delay = Math.floor(Math.random() * 501) + 500;
        pendingMoveFen = boardPlacement;

        autoMoveTimer = setTimeout(async () => {
            autoMoveTimer = null;
            pendingMoveFen = null;

            if (!autoMoveEnabled || isMoving || isGameOver()) return;

            const curPos = readBoard();
            if (!curPos || !curPos.fen) return;
            const curParts = curPos.fen.split(' ');
            const curPlacement = curParts[0] + ' ' + curParts[1];
            if (curPlacement !== boardPlacement) return;
            if (!isPuzzle && curParts[1] !== myColor) return;

            const bestMove = moves && moves[0];
            if (!bestMove || bestMove.length < 4) {
                // If engine hasn't delivered bestmove yet, recheck in 100ms
                autoMoveTimer = setTimeout(() => {
                    autoMoveTimer = null;
                    tickAutoMove();
                }, 100);
                return;
            }

            isMoving = true;
            let moveSucceeded = false;

            const ackPromise = new Promise(resolve => {
                const handler = (e) => {
                    window.removeEventListener('sa-page-move-ack', handler);
                    resolve(e.detail?.ok);
                };
                window.addEventListener('sa-page-move-ack', handler);
                setTimeout(() => {
                    window.removeEventListener('sa-page-move-ack', handler);
                    resolve(false);
                }, 150);
            });

            try {
                await executeMove(bestMove, curPos.board, curPos.flipped, ackPromise);

                // Wait and verify if board position actually updated
                await new Promise(r => setTimeout(r, 220));
                const afterPos = readBoard();
                if (afterPos && afterPos.fen) {
                    const afterParts = afterPos.fen.split(' ');
                    const afterPlacement = afterParts[0] + ' ' + afterParts[1];
                    if (afterPlacement !== boardPlacement) {
                        moveSucceeded = true;
                        lastAutoMoveFen = boardPlacement;
                    }
                }
            } catch (err) {
                console.error('[AutoMove] Execution error:', err);
            } finally {
                if (!moveSucceeded) {
                    // Do not lock lastAutoMoveFen if move didn't happen!
                    lastAutoMoveFen = null;
                }
                setTimeout(() => { isMoving = false; }, 300);
            }
        }, delay);
    }

    function toggleAutoMove() {
        autoMoveEnabled = !autoMoveEnabled;
        if (autoMoveEnabled) {
            let btn = document.getElementById("sa-btn");
            if (!iv && btn) {
                btn.click();
            }
            installInlineBridge();
            showToast('⚡ <b>AUTO MOVE: AKTIF</b><br>Bidak jalan otomatis (0.5 - 1.0s) dari langkah terbaik', '#064e3b', '#10b981', 3000);
        } else {
            if (autoMoveTimer) {
                clearTimeout(autoMoveTimer);
                autoMoveTimer = null;
            }
            pendingMoveFen = null;
            showToast('⏹️ <b>AUTO MOVE: NONAKTIF</b>', '#450a0a', '#ef4444', 2500);
        }
        updateAutoMoveUI();
    }

    function updateAutoMoveUI() {
        const btn = document.getElementById("sa-automove-btn");
        if (!btn) return;
        if (autoMoveEnabled) {
            btn.innerHTML = "Auto: ON [B]";
            btn.style.background = "#059669";
            btn.style.color = "#ffffff";
            btn.style.borderColor = "#10b981";
            btn.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.4)";
        } else {
            btn.innerHTML = "Auto: OFF [B]";
            btn.style.background = "#262421";
            btn.style.color = "#94a3b8";
            btn.style.borderColor = "#3d3b38";
            btn.style.boxShadow = "none";
        }
    }

    // --------------------------------------------------------------------- ui

    function mountUI() {
        let wrap = document.getElementById("sa-wrap");
        let eloBtn = `<button id="sa-elo-btn" style="background:#262421;color:#94a3b8;border:1px solid #3d3b38;border-radius:8px;padding:8px 12px;font:12px sans-serif;font-weight:600;cursor:pointer;white-space:nowrap;">Elo: 1500 [E]</button>`;
        let autoBtn = `<button id="sa-automove-btn" style="background:#262421;color:#94a3b8;border:1px solid #3d3b38;border-radius:8px;padding:8px 12px;font:12px sans-serif;font-weight:600;cursor:pointer;white-space:nowrap;">Auto: OFF [B]</button>`;
        if (!wrap) {
            let variantsBoard = SITE === 'chesscom' && document.querySelector('.TheBoard-layers');
            if (SITE === 'chesscom' && !variantsBoard) {
                let host = document.querySelector(".board-layout-main");
                if (!host) return;
                host.insertAdjacentHTML('afterbegin', `<div id="sa-wrap" style="display:flex;gap:8px;padding:10px;background:var(--globalBackgroundDark);border-radius:5px;margin-bottom:10px;">
                    <button id="sa-btn" class="ui_v5-button-component ui_v5-button-primary" style="flex:1">Start Analyzer (Hotkey: A)</button>
                    ${eloBtn}${autoBtn}
                </div>`);
            } else if (variantsBoard || (SITE === 'endgame' ? findBoardEG() : SITE === 'lichess' && document.querySelector('cg-board'))) {
                document.body.insertAdjacentHTML('beforeend', `<div id="sa-wrap" style="position:fixed;bottom:12px;left:12px;z-index:99999;display:flex;gap:8px;">
                    <button id="sa-btn" style="background:#262421;color:#e0e0e0;border:1px solid #3d3b38;border-radius:8px;padding:8px 14px;font:13px sans-serif;cursor:pointer">Start Analyzer (Hotkey: A)</button>
                    ${eloBtn}${autoBtn}
                </div>`);
            } else {
                return;
            }
            wrap = document.getElementById("sa-wrap");
            document.getElementById("sa-btn").onclick = e => toggle(e.currentTarget);
        }
        if (!document.getElementById("sa-elo-btn")) {
            wrap.insertAdjacentHTML('beforeend', eloBtn);
        }
        if (!document.getElementById("sa-automove-btn")) {
            wrap.insertAdjacentHTML('beforeend', autoBtn);
        }
        document.getElementById("sa-elo-btn").onclick = () => cycleElo();
        document.getElementById("sa-automove-btn").onclick = () => toggleAutoMove();
        updateAutoMoveUI();
        updateEloUI();
    }

    setInterval(() => {
        mountUI();
        queueRelayTick();
    }, 1500);

    setInterval(() => {
        if (autoMoveEnabled) {
            tickAutoMove();
        }
        // Continuous auto-promote ONLY if a promotion dialog is actually present on screen
        if (hasPromotionModal()) {
            const bestPromo = (moves && moves[0] && moves[0].length > 4 ? moves[0][4] : 'q');
            handlePromotion(bestPromo);
        }
        // Auto-select secret queen if in selection phase on Endgame.ai
        if (autoMoveEnabled && SITE === 'endgame' && egSecret.secret === true && !egSecret.ownSquare) {
            autoSelectSecretQueen(lastEGFlipped);
        }
    }, 40);

    window.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && ['c', 'x'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            if (navigator.clipboard) navigator.clipboard.writeText(sessionId).catch(() => {});
            document.getElementById('sa-toast')?.remove();
            document.body.insertAdjacentHTML('beforeend', `<div id="sa-toast" style="position:fixed;bottom:12px;right:12px;z-index:99999;background:#262421;color:#e0e0e0;border:1px solid #3d3b38;border-radius:8px;padding:8px 12px;font:12px sans-serif;">Relay ID copied: <b style="font-family:monospace">${sessionId}</b></div>`);
            setTimeout(() => document.getElementById('sa-toast')?.remove(), 1600);
            return;
        }
        if (e.repeat || e.target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.key.toLowerCase() === 'a') {
            let btn = document.getElementById("sa-btn");
            if (btn) {
                e.preventDefault();
                e.stopImmediatePropagation();
                btn.click();
            }
        }
        if (e.key.toLowerCase() === 'b') {
            e.preventDefault();
            e.stopImmediatePropagation();
            toggleAutoMove();
        }
        if (e.key.toLowerCase() === 'e') {
            e.preventDefault();
            e.stopImmediatePropagation();
            cycleElo();
        }
        if (e.key === 'Insert') {
            e.preventDefault();
            e.stopImmediatePropagation();
            for (let id of ["sa-wrap", "chessweb-relay-badge"]) {
                let el = document.getElementById(id);
                if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
            }
        }
    }, true);

})();
