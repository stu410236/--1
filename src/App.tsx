import React, { useState, useEffect, useCallback } from 'react';
import { 
  RotateCcw, 
  Undo2, 
  Volume2, 
  VolumeX, 
  Trophy, 
  Layers, 
  Info, 
  ChevronUp, 
  ChevronDown, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles,
  Gamepad2,
  User,
  LogOut,
  Medal
} from 'lucide-react';
import { 
  loginAsGuest, 
  saveScoreToLeaderboard, 
  getLocalLeaderboard, 
  LeaderboardEntry 
} from './firebase';

// 定義方塊介面
interface Tile {
  id: string;      // 唯一的 ID，確保 React key 重繪時有滑動過渡動畫
  value: number;   // 方塊數值 (2, 4, 8, 16, 32, ...)
  row: number;     // 所在行 (0 - 3)
  col: number;     // 所在列 (0 - 3)
  isMerged?: boolean; // 是否為剛合併的方塊 (觸發 merge 特效)
  isNew?: boolean;    // 是否為剛生成的方塊 (觸發 pop-in 特效)
}

// 定義歷史記錄介面，用於「復原上一步」
interface GameStateSnapshot {
  tiles: Tile[];
  score: number;
  steps: number;
  hasWonPrompted: boolean;
}

// 產生隨機 ID 函數
const generateId = () => Math.random().toString(36).substring(2, 9);

// 播放瀏覽器內建 Web Audio API 音效 (無須外部音樂檔案，百分之百相容)
const playSound = (type: 'move' | 'merge' | 'win' | 'gameover' | 'click', enabled: boolean) => {
  if (!enabled) return;
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    if (type === 'click') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(450, ctx.currentTime);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === 'move') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === 'merge') {
      // 雙音琶音
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.06, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      playTone(330, 0, 0.12); // E4
      playTone(494, 0.04, 0.18); // B4
    } else if (type === 'win') {
      // 勝利大和弦
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25]; // C E G C E
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);
        gain.gain.setValueAtTime(0.06, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.4);
        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.4);
      });
    } else if (type === 'gameover') {
      // 失敗沉悶音
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(70, ctx.currentTime + 0.5);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    }
  } catch (e) {
    // 忽略瀏覽器不支援 Web Audio 的情況
  }
};

export default function App() {
  // 遊戲核心狀態
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [score, setScore] = useState<number>(0);
  const [bestScore, setBestScore] = useState<number>(() => {
    const saved = localStorage.getItem('2048_best_score');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [steps, setSteps] = useState<number>(0);
  const [history, setHistory] = useState<GameStateSnapshot[]>([]);

  // 訪客登入與排行榜狀態 (預留未來直接升級接上 Firebase Auth & Firestore)
  const [guestName, setGuestName] = useState<string>(() => {
    return localStorage.getItem('2048_guest_username') || '';
  });
  const [showLoginModal, setShowLoginModal] = useState<boolean>(() => {
    return !localStorage.getItem('2048_guest_username');
  });
  const [tempGuestName, setTempGuestName] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => {
    return getLocalLeaderboard();
  });
  
  // 輔助與特效狀態
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [theme, setTheme] = useState<'classic' | 'cyber' | 'slate'>('classic');
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [scorePopups, setScorePopups] = useState<{ id: string; value: number }[]>([]);
  const [moveLogs, setMoveLogs] = useState<{ id: string; text: string }[]>([]);
  
  // 遊戲勝負判斷
  const [gameWon, setGameWon] = useState<boolean>(false);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [hasWonPrompted, setHasWonPrompted] = useState<boolean>(false); // 2048 勝利只提醒一次
  const [keepPlaying, setKeepPlaying] = useState<boolean>(false);     // 達到 2048 後是否繼續挑戰

  // 手勢滑動起點
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  // 1. 生成新方塊
  const spawnTile = useCallback((currentTiles: Tile[]): Tile[] => {
    const occupied = new Set(currentTiles.map(t => `${t.row},${t.col}`));
    const emptyCells: { r: number, c: number }[] = [];
    
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (!occupied.has(`${r},${c}`)) {
          emptyCells.push({ r, c });
        }
      }
    }
    
    if (emptyCells.length === 0) return currentTiles;
    
    const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const value = Math.random() < 0.9 ? 2 : 4; // 90% 機率生成 2，10% 生成 4
    
    const newTile: Tile = {
      id: generateId(),
      value,
      row: randomCell.r,
      col: randomCell.c,
      isNew: true
    };
    
    return [...currentTiles, newTile];
  }, []);

  // 2. 檢測是否遊戲結束
  const checkGameOver = useCallback((currentTiles: Tile[]): boolean => {
    if (currentTiles.length < 16) return false;
    
    // 建立 4x4 的網格矩陣
    const grid: number[][] = Array(4).fill(null).map(() => Array(4).fill(0));
    currentTiles.forEach(t => {
      grid[t.row][t.col] = t.value;
    });
    
    // 檢查水平和垂直方向是否還有可以合併的相鄰方塊
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const val = grid[r][c];
        if (val === 0) return false; // 還有空位
        
        // 檢查右側
        if (c < 3 && val === grid[r][c + 1]) return false;
        // 檢查下方
        if (r < 3 && val === grid[r + 1][c]) return false;
      }
    }
    return true;
  }, []);

  // 3. 初始化遊戲
  const startNewGame = useCallback(() => {
    playSound('click', soundEnabled);
    const initialTiles: Tile[] = [];
    const withOne = spawnTile(initialTiles);
    const withTwo = spawnTile(withOne);
    
    setTiles(withTwo);
    setScore(0);
    setSteps(0);
    setHistory([]);
    setIsGameOver(false);
    setGameWon(false);
    setHasWonPrompted(false);
    setKeepPlaying(false);
    setMoveLogs([
      { id: generateId(), text: '🎮 遊戲開始！祝您好運！' }
    ]);
  }, [spawnTile, soundEnabled]);

  // 初始化首次載入
  useEffect(() => {
    const initialTiles: Tile[] = [];
    const withOne = spawnTile(initialTiles);
    const withTwo = spawnTile(withOne);
    setTiles(withTwo);
    setMoveLogs([
      { id: generateId(), text: '🎮 遊戲載入成功，開始挑戰吧！' }
    ]);
  }, []);

  // 4. 滑動核心引擎
  const move = useCallback((direction: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT') => {
    if (isGameOver || (gameWon && !keepPlaying)) return;

    let currentTiles = tiles.map(t => ({ ...t }));
    let scoreGain = 0;
    let moved = false;
    let mergeCount = 0;
    let maxMergedVal = 0;

    // 將方塊依行或列分組，並根據滑動方向排序
    for (let i = 0; i < 4; i++) {
      let lineTiles: Tile[] = [];
      
      if (direction === 'LEFT' || direction === 'RIGHT') {
        lineTiles = currentTiles.filter(t => t.row === i);
        if (direction === 'LEFT') {
          lineTiles.sort((a, b) => a.col - b.col);
        } else {
          lineTiles.sort((a, b) => b.col - a.col);
        }
      } else {
        lineTiles = currentTiles.filter(t => t.col === i);
        if (direction === 'UP') {
          lineTiles.sort((a, b) => a.row - b.row);
        } else {
          lineTiles.sort((a, b) => b.row - a.row);
        }
      }

      // 進行滑動與合併計算
      const slidLine: Tile[] = [];
      let skip = false;

      for (let j = 0; j < lineTiles.length; j++) {
        if (skip) {
          skip = false;
          continue;
        }

        const current = { ...lineTiles[j], isNew: false, isMerged: false };
        const next = lineTiles[j + 1];

        // 計算滑動後的新座標
        const getNewCoords = (index: number) => {
          if (direction === 'LEFT') return { r: i, c: index };
          if (direction === 'RIGHT') return { r: i, c: 3 - index };
          if (direction === 'UP') return { r: index, c: i };
          return { r: 3 - index, c: i }; // DOWN
        };

        if (next && current.value === next.value) {
          // 合併方塊
          const newValue = current.value * 2;
          current.value = newValue;
          current.isMerged = true;
          scoreGain += newValue;
          mergeCount++;
          if (newValue > maxMergedVal) maxMergedVal = newValue;

          const coords = getNewCoords(slidLine.length);
          current.row = coords.r;
          current.col = coords.c;

          slidLine.push(current);
          skip = true;
          moved = true;
        } else {
          // 單純移動
          const coords = getNewCoords(slidLine.length);
          if (current.row !== coords.r || current.col !== coords.c) {
            moved = true;
          }
          current.row = coords.r;
          current.col = coords.c;
          slidLine.push(current);
        }
      }

      // 更新目前網格的方塊
      if (direction === 'LEFT' || direction === 'RIGHT') {
        currentTiles = currentTiles.filter(t => t.row !== i).concat(slidLine);
      } else {
        currentTiles = currentTiles.filter(t => t.col !== i).concat(slidLine);
      }
    }

    // 若有方塊移動，進行後續遊戲邏輯更新
    if (moved) {
      // 1. 記錄此步前的快照，以便復原
      const snapshot: GameStateSnapshot = {
        tiles: tiles.map(t => ({ ...t })),
        score: score,
        steps: steps,
        hasWonPrompted: hasWonPrompted
      };
      setHistory(prev => [snapshot, ...prev].slice(0, 15)); // 最多儲存 15 步歷史紀錄

      // 2. 生成一個新方塊
      const spawnedBoard = spawnTile(currentTiles);
      setTiles(spawnedBoard);

      // 3. 更新分數與最高分
      const newScore = score + scoreGain;
      setScore(newScore);
      setSteps(prev => prev + 1);

      if (newScore > bestScore) {
        setBestScore(newScore);
        localStorage.setItem('2048_best_score', newScore.toString());
      }

      // 4. 記錄行動日誌與播放音效
      const dirText = { UP: '⬆️ 向上', DOWN: '⬇️ 向下', LEFT: '⬅️ 向左', RIGHT: '➡️ 向右' }[direction];
      let logMsg = `第 ${steps + 1} 步: ${dirText} 移動`;
      if (mergeCount > 0) {
        logMsg += `，合併了 ${mergeCount} 組方塊，最大獲得 ${maxMergedVal} 分！`;
      }
      setMoveLogs(prev => [
        { id: generateId(), text: logMsg },
        ...prev.slice(0, 19) // 保留前 20 條記錄
      ]);

      if (scoreGain > 0) {
        const popupId = generateId();
        setScorePopups(prev => [...prev, { id: popupId, value: scoreGain }]);
        setTimeout(() => {
          setScorePopups(prev => prev.filter(p => p.id !== popupId));
        }, 800);
        playSound('merge', soundEnabled);
      } else {
        playSound('move', soundEnabled);
      }

      // 5. 判斷是否達到 2048 勝利
      const maxTileValue = Math.max(...spawnedBoard.map(t => t.value), 0);
      if (maxTileValue >= 2048 && !hasWonPrompted && !keepPlaying) {
        setGameWon(true);
        setHasWonPrompted(true);
        playSound('win', soundEnabled);
        saveScoreToLeaderboard(guestName || '訪客', newScore, steps + 1, maxTileValue).then(updated => {
          setLeaderboard(updated);
        });
      }

      // 6. 判斷是否遊戲結束
      if (checkGameOver(spawnedBoard)) {
        setIsGameOver(true);
        playSound('gameover', soundEnabled);
        saveScoreToLeaderboard(guestName || '訪客', newScore, steps + 1, maxTileValue).then(updated => {
          setLeaderboard(updated);
        });
      }
    }
  }, [tiles, score, bestScore, steps, hasWonPrompted, keepPlaying, isGameOver, gameWon, soundEnabled, spawnTile, checkGameOver, guestName]);

  // 5. 復原上一步
  const handleUndo = () => {
    if (history.length === 0) return;
    playSound('click', soundEnabled);
    
    const lastState = history[0];
    setTiles(lastState.tiles);
    setScore(lastState.score);
    setSteps(lastState.steps);
    setHasWonPrompted(lastState.hasWonPrompted);
    
    // 重設可能的勝負狀態
    setIsGameOver(false);
    setGameWon(false);

    setMoveLogs(prev => [
      { id: generateId(), text: '⏪ 復原了上一步行動！' },
      ...prev.slice(0, 19)
    ]);
    
    setHistory(prev => prev.slice(1));
  };

  // 6. 鍵盤監聽事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.key)) {
        e.preventDefault(); // 防止網頁跟著上下滾動
      }
      
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          move('UP');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          move('DOWN');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          move('LEFT');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          move('RIGHT');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [move]);

  // 7. 手勢滑動偵測
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    setTouchStart({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    });
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart || e.changedTouches.length !== 1) return;
    const deltaX = e.changedTouches[0].clientX - touchStart.x;
    const deltaY = e.changedTouches[0].clientY - touchStart.y;
    
    const minSwipeDistance = 45; // 最小觸發距離 (像素)
    
    if (Math.abs(deltaX) < minSwipeDistance && Math.abs(deltaY) < minSwipeDistance) {
      return;
    }
    
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX > 0) {
        move('RIGHT');
      } else {
        move('LEFT');
      }
    } else {
      if (deltaY > 0) {
        move('DOWN');
      } else {
        move('UP');
      }
    }
    setTouchStart(null);
  };

  // 輔助獲取當前最高數值的方塊
  const getMaxTileValue = () => {
    return tiles.length > 0 ? Math.max(...tiles.map(t => t.value)) : 0;
  };

  // 根據方塊數值與主題回傳對應的樣式類
  const getTileStyles = (val: number) => {
    if (theme === 'cyber') {
      switch (val) {
        case 2: return 'bg-[#181a30] text-[#00f2fe] border border-[#00f2fe]/30';
        case 4: return 'bg-[#1b2246] text-[#00f2fe] border border-[#00f2fe]/60';
        case 8: return 'bg-[#29173f] text-[#ff2a5f] border border-[#ff2a5f]/30';
        case 16: return 'bg-[#3b1138] text-[#ff2a5f] border border-[#ff2a5f]/60';
        case 32: return 'bg-[#0b3356] text-[#05ffa1] border border-[#05ffa1]/30';
        case 64: return 'bg-[#04597b] text-[#05ffa1] border border-[#05ffa1]/70';
        case 128: return 'bg-[#400063] text-[#e0aaff] shadow-[0_0_12px_rgba(224,170,255,0.6)]';
        case 256: return 'bg-[#5500c4] text-[#e0aaff] shadow-[0_0_15px_rgba(100,0,228,0.7)]';
        case 512: return 'bg-[#6b0012] text-[#ff8fa3] shadow-[0_0_18px_rgba(122,0,22,0.8)]';
        case 1024: return 'bg-[#005c00] text-[#ccff33] shadow-[0_0_20px_rgba(0,114,0,0.8)]';
        case 2048: return 'bg-[#009cb8] text-white shadow-[0_0_25px_rgba(0,180,216,0.95)] animate-pulse';
        default: return 'bg-[#d80064] text-white shadow-[0_0_30px_rgba(255,0,127,1)]';
      }
    }
    
    if (theme === 'slate') {
      switch (val) {
        case 2: return 'bg-slate-100 text-slate-600';
        case 4: return 'bg-slate-200 text-slate-700';
        case 8: return 'bg-slate-300 text-slate-800';
        case 16: return 'bg-slate-400 text-white';
        case 32: return 'bg-slate-500 text-white';
        case 64: return 'bg-slate-600 text-white';
        case 128: return 'bg-slate-700 text-white border border-slate-400';
        case 256: return 'bg-slate-800 text-white border border-slate-300 shadow';
        case 512: return 'bg-slate-900 text-white shadow-md';
        case 1024: return 'bg-emerald-700 text-emerald-50 shadow-md';
        case 2048: return 'bg-emerald-800 text-white shadow-lg animate-pulse';
        default: return 'bg-[#020617] text-white shadow-xl';
      }
    }

    // 經典主題 (Classic Warm)
    switch (val) {
      case 2: return 'bg-[#eee4da] text-[#776e65]';
      case 4: return 'bg-[#ede0c8] text-[#776e65]';
      case 8: return 'bg-[#f2b179] text-[#f9f6f2]';
      case 16: return 'bg-[#f59563] text-[#f9f6f2]';
      case 32: return 'bg-[#f67c5f] text-[#f9f6f2]';
      case 64: return 'bg-[#f65e3b] text-[#f9f6f2]';
      case 128: return 'bg-[#edcf72] text-[#f9f6f2] shadow-[0_0_10px_rgba(237,207,114,0.5)]';
      case 256: return 'bg-[#edcc61] text-[#f9f6f2] shadow-[0_0_12px_rgba(237,204,97,0.6)]';
      case 512: return 'bg-[#edc850] text-[#f9f6f2] shadow-[0_0_15px_rgba(237,200,80,0.7)]';
      case 1024: return 'bg-[#edc53f] text-[#f9f6f2] shadow-[0_0_18px_rgba(237,197,63,0.8)]';
      case 2048: return 'bg-[#edc22e] text-[#f9f6f2] shadow-[0_0_25px_rgba(237,194,46,0.95)] animate-pulse';
      default: return 'bg-[#3c3a32] text-[#f9f6f2] shadow-[0_0_30px_rgba(60,58,50,0.9)]';
    }
  };

  // 取得方塊的定位樣式
  const getTileStyle = (tile: Tile) => {
    return {
      top: `calc(${tile.row} * 25%)`,
      left: `calc(${tile.col} * 25%)`,
      width: '25%',
      height: '25%',
    };
  };

  // 不同的主題頁面背景
  const getThemeBg = () => {
    if (theme === 'cyber') return 'bg-[#080914] text-[#a5b4fc]';
    if (theme === 'slate') return 'bg-[#f8fafc] text-[#334155]';
    return 'bg-[#faf8ef] text-[#776e65]';
  };

  return (
    <div className={`min-h-screen py-8 px-4 md:px-12 font-sans transition-colors duration-300 ${getThemeBg()}`}>
      <div className="max-w-7xl mx-auto flex flex-col xl:flex-row gap-6 items-start justify-center">
        
        {/* ================= COLUMN 1: LEFT SIDEBAR (INSTRUCTIONS) ================= */}
        <div className="w-full xl:w-64 shrink-0 flex flex-col gap-4">
          
          {/* Guest Identity Card */}
          <div className={`p-5 rounded-2xl transition-all shadow-[0_4px_6px_rgba(0,0,0,0.05)] border ${
            theme === 'cyber' ? 'bg-[#0f1124] border-[#00f2fe]/20 text-indigo-200' :
            theme === 'slate' ? 'bg-white border-slate-200 text-slate-700' :
            'bg-white border-[#f1ebd9] text-[#776e65]'
          }`}>
            <h2 className="text-xs font-black uppercase tracking-wider mb-3 flex items-center gap-1.5 border-b pb-2 border-current/10">
              <User size={14} className="text-orange-500" />
              目前訪客身分
            </h2>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate">
                <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center font-extrabold text-orange-500 shrink-0 text-sm">
                  {guestName ? guestName[0].toUpperCase() : 'G'}
                </div>
                <div className="truncate">
                  <div className="text-xs font-black truncate">{guestName || '未登入'}</div>
                  <div className="text-[9px] opacity-65 font-mono">ID: guest_cached</div>
                </div>
              </div>
              <button
                id="btn-switch-user"
                onClick={() => {
                  playSound('click', soundEnabled);
                  setTempGuestName(guestName);
                  setShowLoginModal(true);
                }}
                className="p-1.5 rounded-lg hover:bg-orange-500/10 hover:text-orange-500 text-current/60 transition-all shrink-0 cursor-pointer"
                title="切換訪客身分"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>

          <div className={`p-5 rounded-2xl transition-all shadow-[0_4px_6px_rgba(0,0,0,0.05)] border ${
            theme === 'cyber' ? 'bg-[#0f1124] border-[#00f2fe]/20 text-indigo-200' :
            theme === 'slate' ? 'bg-white border-slate-200 text-slate-700' :
            'bg-white border-[#f1ebd9] text-[#776e65]'
          }`}>
            <h2 className="text-lg font-bold mb-4 uppercase tracking-wider flex items-center gap-1.5 border-b pb-2 border-current/10">
              <Info size={16} />
              操作指引
            </h2>
            <p className="text-xs leading-relaxed mb-4 opacity-90">
              使用您的<strong>方向鍵</strong>、<strong>W-A-S-D</strong> 或在網格上<strong>滑動手指</strong>來移動方塊。當兩個數值相同的方塊碰在一起時，它們會<strong>合併為一！</strong>
            </p>
            
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">&uarr;</div>
                <span className="text-xs font-bold uppercase opacity-80 tracking-wide">向上滑動</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">&larr;</div>
                <span className="text-xs font-bold uppercase opacity-80 tracking-wide">向左滑動</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">&rarr;</div>
                <span className="text-xs font-bold uppercase opacity-80 tracking-wide">向右滑動</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gray-100 rounded-md border border-gray-200 flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">&darr;</div>
                <span className="text-xs font-bold uppercase opacity-80 tracking-wide">向下滑動</span>
              </div>
            </div>
          </div>
          
          <div className="text-[10px] uppercase font-black text-gray-400 text-center tracking-widest hidden xl:block">
            Version 2.0.48 Edition
          </div>
        </div>

        {/* ================= COLUMN 2: CENTER (CORE GAMEBOARD) ================= */}
        <div className="flex-1 max-w-lg w-full flex flex-col items-center">
          
          {/* Logo Title and Score Boxes */}
          <div className="flex items-center justify-between w-full mb-5 gap-4">
            <div className="flex flex-col">
              <h1 className="text-6xl font-black tracking-tight leading-none text-[#776e65] select-none font-sans">
                2048
              </h1>
              <p className="text-xs font-bold uppercase tracking-wider opacity-60 mt-1 select-none">
                Vibrant Edition
              </p>
            </div>
            
            <div className="flex gap-2">
              {/* Score Box */}
              <div className={`relative px-4 py-2.5 rounded-lg text-center min-w-[90px] shadow-sm ${
                theme === 'cyber' ? 'bg-[#151730] border border-[#00f2fe]/20' : 
                theme === 'slate' ? 'bg-slate-100 border border-slate-200 text-slate-700' : 
                'bg-[#bbada0] text-[#f9f6f2]'
              }`}>
                <div className="text-[10px] uppercase font-black tracking-wider opacity-75">SCORE</div>
                <div className="text-xl font-extrabold font-mono leading-none mt-1">{score}</div>
                
                {/* Score floating popups */}
                {scorePopups.map(popup => (
                  <span 
                    key={popup.id} 
                    className="absolute left-1/2 -translate-x-1/2 -top-6 text-orange-500 font-extrabold text-base animate-float-score pointer-events-none"
                  >
                    +{popup.value}
                  </span>
                ))}
              </div>

              {/* Best Score Box */}
              <div className={`px-4 py-2.5 rounded-lg text-center min-w-[90px] shadow-sm ${
                theme === 'cyber' ? 'bg-[#151730] border border-[#ff2a5f]/20' : 
                theme === 'slate' ? 'bg-slate-100 border border-slate-200 text-slate-700' : 
                'bg-[#bbada0] text-[#f9f6f2]'
              }`}>
                <div className="text-[10px] uppercase font-black tracking-wider opacity-75 flex items-center justify-center gap-0.5">
                  <Trophy size={11} className="text-yellow-400" />
                  BEST
                </div>
                <div className="text-xl font-extrabold font-mono leading-none mt-1">{bestScore}</div>
              </div>
            </div>
          </div>

          {/* Quick Toolbar: Sounds & Themes */}
          <div className="flex items-center justify-between w-full mt-1 mb-4 text-xs opacity-90 py-1.5 border-y border-current/10">
            <div className="flex items-center gap-2">
              <button
                id="btn-toggle-sound"
                onClick={() => setSoundEnabled(prev => !prev)}
                className="p-1 rounded hover:bg-current/5 transition-all flex items-center gap-1"
                title={soundEnabled ? "關閉音效" : "開啟音效"}
              >
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span className="text-[10px] font-bold uppercase tracking-wider">{soundEnabled ? "開啟" : "靜音"}</span>
              </button>
            </div>
            
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase font-black tracking-wider opacity-60 mr-1">主題:</span>
              <button 
                id="btn-theme-classic"
                onClick={() => { playSound('click', soundEnabled); setTheme('classic'); }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${theme === 'classic' ? 'bg-[#f65e3b] text-white shadow-sm' : 'opacity-60 hover:opacity-100'}`}
              >
                經典
              </button>
              <button 
                id="btn-theme-cyber"
                onClick={() => { playSound('click', soundEnabled); setTheme('cyber'); }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${theme === 'cyber' ? 'bg-[#00f2fe] text-black shadow-sm' : 'opacity-60 hover:opacity-100'}`}
              >
                科幻
              </button>
              <button 
                id="btn-theme-slate"
                onClick={() => { playSound('click', soundEnabled); setTheme('slate'); }}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${theme === 'slate' ? 'bg-slate-700 text-white shadow-sm' : 'opacity-60 hover:opacity-100'}`}
              >
                極簡
              </button>
            </div>
          </div>

          {/* Gameboard container */}
          <div 
            className={`relative w-full aspect-square rounded-2xl p-3.5 shadow-xl overflow-hidden transition-all duration-300 select-none ${
              theme === 'cyber' ? 'bg-[#0f1124] border-2 border-[#00f2fe]/30' :
              theme === 'slate' ? 'bg-slate-100 border border-slate-300' :
              'bg-[#bbada0]'
            }`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {/* Background 16 cells */}
            <div className="grid grid-cols-4 grid-rows-4 gap-3.5 w-full h-full">
              {Array.from({ length: 16 }).map((_, idx) => (
                <div 
                  key={idx} 
                  className={`rounded-lg aspect-square transition-colors duration-300 ${
                    theme === 'cyber' ? 'bg-[#151730] border border-cyan-500/10' :
                    theme === 'slate' ? 'bg-slate-200/60' : 
                    'bg-white/35'
                  }`} 
                />
              ))}
            </div>

            {/* Moving tile pieces */}
            <div className="absolute inset-3.5 pointer-events-none">
              {tiles.map(tile => (
                <div
                  key={tile.id}
                  className="absolute transition-all duration-150 ease-in-out p-1 tile-gpu"
                  style={getTileStyle(tile)}
                >
                  <div className={`w-full h-full rounded-lg flex flex-col justify-center items-center font-bold text-center select-none shadow-sm transition-colors duration-300 ${getTileStyles(tile.value)} ${tile.isNew ? 'animate-pop-in' : ''} ${tile.isMerged ? 'animate-merge' : ''}`}>
                    <span className={`font-sans font-extrabold leading-none tracking-tight ${
                      tile.value >= 100000 ? 'text-lg' :
                      tile.value >= 10000 ? 'text-xl' :
                      tile.value >= 1000 ? 'text-2xl' :
                      tile.value >= 100 ? 'text-3xl' :
                      'text-4xl'
                    }`}>
                      {tile.value}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Victory overlay */}
            {gameWon && (
              <div className="absolute inset-0 bg-yellow-500/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center text-slate-950 animate-pop-in z-20">
                <Sparkles size={48} className="text-white mb-2 animate-bounce" />
                <h2 className="text-3xl font-black mb-1">🎉 恭喜達成 2048！</h2>
                <p className="text-sm opacity-90 max-w-xs mb-6 font-semibold">你太厲害了！已成功突破至傳奇的 2048 方塊，要繼續往下挑戰 4096 甚至 8192 嗎？</p>
                <div className="flex gap-3">
                  <button
                    id="btn-keep-playing"
                    onClick={() => {
                      playSound('click', soundEnabled);
                      setGameWon(false);
                      setKeepPlaying(true);
                      setMoveLogs(prev => [
                        { id: generateId(), text: '🚀 玩家選擇繼續，向 4096 與更高極限發起進攻！' },
                        ...prev
                      ]);
                    }}
                    className="px-5 py-2.5 bg-slate-950 text-white rounded-lg font-bold text-sm hover:bg-slate-800 transition shadow-md"
                  >
                    繼續挑戰
                  </button>
                  <button
                    id="btn-won-restart"
                    onClick={startNewGame}
                    className="px-5 py-2.5 bg-white text-yellow-900 rounded-lg font-bold text-sm hover:bg-yellow-50 transition shadow-md"
                  >
                    重新開始
                  </button>
                </div>
              </div>
            )}

            {/* Gameover overlay */}
            {isGameOver && (
              <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center text-white animate-pop-in z-20">
                <h2 className="text-3xl font-black mb-2 text-[#ff2a5f]">GAME OVER</h2>
                <p className="text-sm text-slate-400 max-w-xs mb-6">棋盤已經滿了，而且沒有相鄰的相同方塊可以合併。別氣餒，快復原上一步或是重新挑戰吧！</p>
                <div className="flex gap-3">
                  <button
                    id="btn-over-undo"
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    className="px-4 py-2.5 bg-indigo-600 disabled:opacity-40 rounded-lg font-bold text-sm hover:bg-indigo-500 transition flex items-center gap-1 shadow-md"
                  >
                    <Undo2 size={14} />
                    復原上一步
                  </button>
                  <button
                    id="btn-over-restart"
                    onClick={startNewGame}
                    className="px-4 py-2.5 bg-[#ff2a5f] rounded-lg font-bold text-sm hover:bg-[#ff2a5f]/80 transition flex items-center gap-1 shadow-md"
                  >
                    <RotateCcw size={14} />
                    重新挑戰
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Action Row: New Game, Undo Link */}
          <div className="flex justify-between w-full mt-6 items-center">
            <button
              id="btn-restart-primary"
              onClick={startNewGame}
              className="px-6 py-3.5 bg-[#f65e3b] hover:bg-[#e04f2c] text-white rounded-lg font-bold text-base transition-all transform hover:scale-[1.03] active:scale-[0.98] cursor-pointer shadow-md flex items-center gap-2"
            >
              <RotateCcw size={18} />
              New Game
            </button>
            
            <button
              id="btn-undo-link"
              onClick={handleUndo}
              disabled={history.length === 0}
              className="text-sm font-bold uppercase text-[#8f7a66] hover:text-[#776e65] disabled:opacity-40 disabled:no-underline cursor-pointer border-b-2 border-[#8f7a66] hover:border-[#776e65] pb-0.5 tracking-wide transition-colors"
            >
              Undo Move
            </button>
          </div>

          {/* Collapsible Helper Control Pad for Touch Devices */}
          <div className="mt-6 flex flex-col items-center">
            <div className="text-[10px] tracking-wider opacity-50 mb-1.5 uppercase font-black">輔助手動控制板</div>
            <div className="flex flex-col items-center gap-1">
              <button 
                id="btn-move-up"
                onClick={() => move('UP')} 
                className="p-2.5 rounded-lg border border-current/15 hover:bg-current/5 transition-all transform active:scale-90"
              >
                <ChevronUp size={16} />
              </button>
              <div className="flex gap-6">
                <button 
                  id="btn-move-left"
                  onClick={() => move('LEFT')} 
                  className="p-2.5 rounded-lg border border-current/15 hover:bg-current/5 transition-all transform active:scale-90"
                >
                  <ChevronLeft size={16} />
                </button>
                <button 
                  id="btn-move-right"
                  onClick={() => move('RIGHT')} 
                  className="p-2.5 rounded-lg border border-current/15 hover:bg-current/5 transition-all transform active:scale-90"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <button 
                id="btn-move-down"
                onClick={() => move('DOWN')} 
                className="p-2.5 rounded-lg border border-current/15 hover:bg-current/5 transition-all transform active:scale-90"
              >
                <ChevronDown size={16} />
              </button>
            </div>
          </div>

        </div>

        {/* ================= COLUMN 3: RIGHT SIDEBAR (CURRENT RUN, PRO TIP & LOGS) ================= */}
        <div className="w-full xl:w-72 shrink-0 flex flex-col gap-5">
          
          {/* Current Run Stat Card */}
          <div className={`p-5 rounded-2xl border shadow-[0_4px_6px_rgba(0,0,0,0.05)] transition-all ${
            theme === 'cyber' ? 'bg-[#0f1124] border-[#00f2fe]/20 text-indigo-100' :
            theme === 'slate' ? 'bg-white border-slate-200 text-slate-700' :
            'bg-white border-[#f1ebd9] text-[#776e65]'
          }`}>
            <h2 className="text-sm font-black mb-4 uppercase tracking-wider border-b pb-2 border-current/10 flex items-center gap-1.5">
              <Sparkles size={14} className="text-orange-500" />
              本次對局戰況
            </h2>
            <div className="space-y-3.5">
              <div className="flex justify-between items-end border-b border-dashed border-current/10 pb-2">
                <span className="text-[11px] font-bold uppercase opacity-65">總移動步數</span>
                <span className="font-mono font-extrabold text-lg leading-none">{steps}</span>
              </div>
              <div className="flex justify-between items-end border-b border-dashed border-current/10 pb-2">
                <span className="text-[11px] font-bold uppercase opacity-65">最大合併方塊</span>
                <span className="font-mono font-extrabold text-lg leading-none">{getMaxTileValue()}</span>
              </div>
              <div className="flex justify-between items-end pb-1">
                <span className="text-[11px] font-bold uppercase opacity-65">復原可用步數</span>
                <span className="font-mono font-extrabold text-lg leading-none text-indigo-500">{history.length}</span>
              </div>
            </div>
          </div>

          {/* Leaderboard Card (Firebase Reserved) */}
          <div className={`p-5 rounded-2xl border shadow-[0_4px_6px_rgba(0,0,0,0.05)] transition-all ${
            theme === 'cyber' ? 'bg-[#0f1124] border-[#00f2fe]/20 text-indigo-100' :
            theme === 'slate' ? 'bg-white border-slate-200 text-slate-700' :
            'bg-white border-[#f1ebd9] text-[#776e65]'
          }`}>
            <h2 className="text-sm font-black mb-3.5 uppercase tracking-wider border-b pb-2 border-current/10 flex items-center gap-1.5">
              <Trophy size={14} className="text-yellow-500 animate-pulse" />
              訪客排行榜 (Firebase 預留)
            </h2>
            <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
              {leaderboard.length === 0 ? (
                <div className="text-[11px] text-center py-4 opacity-50 italic">
                  暫無排行紀錄，快來進行第一局吧！
                </div>
              ) : (
                leaderboard.slice(0, 8).map((entry, index) => {
                  const isCurrent = entry.username === guestName;
                  return (
                    <div 
                      key={entry.id} 
                      className={`flex items-center justify-between p-1.5 rounded-lg text-xs transition-all ${
                        isCurrent 
                          ? 'bg-orange-500/10 border border-orange-500/30' 
                          : 'bg-current/[0.03]'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate mr-2">
                        {index === 0 ? (
                          <span className="text-base select-none shrink-0">🥇</span>
                        ) : index === 1 ? (
                          <span className="text-base select-none shrink-0">🥈</span>
                        ) : index === 2 ? (
                          <span className="text-base select-none shrink-0">🥉</span>
                        ) : (
                          <span className="w-4 text-center font-mono text-[10px] opacity-40 shrink-0">{index + 1}</span>
                        )}
                        <span className={`font-semibold truncate text-[11px] ${isCurrent ? 'text-orange-500 font-bold' : ''}`}>
                          {entry.username}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono shrink-0">
                        <span className="text-[9px] opacity-50 font-bold px-1 py-0.5 rounded bg-current/5">{entry.maxTile}</span>
                        <span className="font-extrabold text-right text-xs min-w-[36px]">{entry.score}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="text-[9px] opacity-45 mt-2.5 text-center leading-normal">
              本機儲存完畢。未來連接 Firebase 將進行雲端排名！
            </div>
          </div>

          {/* Pro Tip Card */}
          <div className="p-4 bg-orange-50/80 border border-orange-100 rounded-2xl shadow-sm text-slate-700">
            <h3 className="text-orange-600 font-extrabold text-xs mb-1.5 flex items-center gap-1 tracking-wider">
              <Sparkles size={13} className="animate-pulse" />
              PRO TIP
            </h3>
            <p className="text-xs italic text-orange-800 font-medium leading-relaxed">
              "Keep your highest tile in a corner for maximum board space!"
            </p>
          </div>

          {/* Live Action Game logs */}
          <div className={`p-5 rounded-2xl border flex-1 min-h-[160px] lg:min-h-[220px] flex flex-col justify-between ${
            theme === 'cyber' ? 'bg-[#0f1124] border-[#00f2fe]/20 text-indigo-100' :
            theme === 'slate' ? 'bg-white border-slate-200 text-slate-700' :
            'bg-white border-[#f1ebd9] text-[#776e65]'
          }`}>
            <div>
              <h3 className="text-xs font-black flex items-center gap-1.5 mb-2.5 uppercase tracking-wider border-b border-current/10 pb-2">
                <Layers size={13} />
                即時對戰日誌
              </h3>
              <div className="overflow-y-auto max-h-[180px] space-y-1.5 pr-1 text-[11px]">
                {moveLogs.map(log => (
                  <div 
                    key={log.id} 
                    className="p-1.5 rounded transition bg-current/[0.03] border-l-2 border-orange-500/80 text-current opacity-90"
                  >
                    {log.text}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="text-[10px] opacity-45 mt-4 text-center">
              <span>支援瀏覽器本機快取，隨時退出不流失最佳戰績</span>
            </div>
          </div>

        </div>

      </div>

      {/* 訪客登入彈出視窗 (Firebase 預留) */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-pop-in">
          <div className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl border transition-all ${
            theme === 'cyber' ? 'bg-[#0f1124] border-[#00f2fe]/30 text-indigo-200' :
            theme === 'slate' ? 'bg-white border-slate-200 text-slate-700' :
            'bg-white border-[#f1ebd9] text-[#776e65]'
          }`}>
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 bg-orange-500/10 text-orange-500 rounded-xl">
                <Gamepad2 size={24} />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight leading-none">2048 訪客登入</h3>
                <p className="text-[10px] uppercase font-bold tracking-widest text-orange-500/80 mt-1">Firebase Ready</p>
              </div>
            </div>
            
            <p className="text-xs leading-relaxed mb-4 opacity-80">
              設定一個您的專屬暱稱！此系統已預留 Firebase 串接，未來將一鍵升級為雲端實時對局排行。
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider mb-1.5 opacity-70">
                  您的暱稱
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={15}
                    value={tempGuestName}
                    onChange={(e) => setTempGuestName(e.target.value)}
                    placeholder="請輸入暱稱..."
                    className="flex-1 px-3.5 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/50 bg-current/[0.02] border-current/15 text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click', soundEnabled);
                      const nicks = ['滑動大師', '方塊獵人', '極限拼圖王', '黃金守角人', '合體狂熱者', '幸運星', '角落守護神', '矩陣行者', '拼圖奇才'];
                      const randomNick = nicks[Math.floor(Math.random() * nicks.length)] + '_' + Math.floor(100 + Math.random() * 899);
                      setTempGuestName(randomNick);
                    }}
                    className="px-3 py-2.5 bg-current/[0.05] border border-current/10 rounded-lg text-xs font-bold hover:bg-current/[0.1] transition-all cursor-pointer"
                    title="隨機產生暱稱"
                  >
                    隨機
                  </button>
                </div>
              </div>

              <div className="flex gap-2.5 pt-2">
                {guestName && (
                  <button
                    type="button"
                    onClick={() => {
                      playSound('click', soundEnabled);
                      setShowLoginModal(false);
                    }}
                    className="flex-1 py-2.5 border border-current/15 rounded-lg text-xs font-bold hover:bg-current/[0.03] transition-all cursor-pointer"
                  >
                    取消
                  </button>
                )}
                <button
                  type="button"
                  disabled={!tempGuestName.trim() || isLoggingIn}
                  onClick={() => {
                    if (!tempGuestName.trim()) return;
                    playSound('click', soundEnabled);
                    setIsLoggingIn(true);
                    loginAsGuest(tempGuestName.trim()).then((user) => {
                      setGuestName(user.username);
                      localStorage.setItem('2048_guest_username', user.username);
                      setIsLoggingIn(false);
                      setShowLoginModal(false);
                      setTempGuestName('');
                      setMoveLogs(prev => [
                        { id: generateId(), text: `👋 歡迎訪客 ${user.username} 登入！` },
                        ...prev
                      ]);
                    });
                  }}
                  className="flex-1 py-2.5 bg-[#f65e3b] hover:bg-[#e04f2c] disabled:opacity-50 text-white rounded-lg text-xs font-extrabold shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isLoggingIn ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : '登入遊戲'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// 輔助檢查是否為寬螢幕 (寬度足夠時自動顯示指南)
function lgScreenDevice() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= 1024;
}
