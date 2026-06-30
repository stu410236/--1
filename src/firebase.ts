/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// ==========================================
// Firebase 預留設定與未來串接指南
// ==========================================
// 
// 您未來要啟用 Firebase 時，請執行以下步驟：
// 1. 在 Google AI Studio 開發平台中，使用 Firebase 設定工具或自己建立專案。
// 2. 安裝 Firebase SDK (使用 npm install firebase)
// 3. 將下方的「// 未來啟用：」區塊解除註解，並填入您的 Firebase 專案設定資訊。
// 4. 將現有的 mock (模擬) 函數替換為真實的 Firestore / Firebase Auth 呼叫。

/*
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
*/

// ==========================================
// 目前使用的模擬 (Mock) 本地離線存儲引擎
// ==========================================

export interface LeaderboardEntry {
  id: string;
  username: string;
  score: number;
  steps: number;
  maxTile: number;
  timestamp: string;
}

// 模擬訪客自動登入
export const loginAsGuest = async (username: string): Promise<{ uid: string; username: string }> => {
  // 未來啟用真實 Firebase 匿名登入時，可改寫為：
  // const userCredential = await signInAnonymously(auth);
  // return { uid: userCredential.user.uid, username };
  
  return new Promise((resolve) => {
    setTimeout(() => {
      const uid = 'guest_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('2048_guest_uid', uid);
      localStorage.setItem('2048_guest_username', username);
      resolve({ uid, username });
    }, 500);
  });
};

// 儲存分數至排行榜
export const saveScoreToLeaderboard = async (
  username: string, 
  score: number, 
  steps: number, 
  maxTile: number
): Promise<LeaderboardEntry[]> => {
  // 未來啟用真實 Firestore 時，可改寫為：
  // await addDoc(collection(db, "leaderboard"), { username, score, steps, maxTile, timestamp: new Date().toISOString() });
  
  const newEntry: LeaderboardEntry = {
    id: Math.random().toString(36).substring(2, 9),
    username,
    score,
    steps,
    maxTile,
    timestamp: new Date().toLocaleDateString('zh-TW', { hour: '2-digit', minute: '2-digit' })
  };

  const currentLeaderboard = getLocalLeaderboard();
  
  // 檢查該使用者是否已有記錄，若有且新分數較高則更新，或直接新增一筆（此處我們直接記錄每次挑戰，以利排行）
  currentLeaderboard.push(newEntry);
  
  // 依分數從大到小排序，若分數相同則步數較少者優先
  currentLeaderboard.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.steps - b.steps;
  });

  // 只保留前 100 名
  const trimmed = currentLeaderboard.slice(0, 100);
  localStorage.setItem('2048_leaderboard', JSON.stringify(trimmed));
  
  return trimmed;
};

// 讀取排行榜
export const getLocalLeaderboard = (): LeaderboardEntry[] => {
  // 未來啟用真實 Firestore 時，可改寫為：
  // const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(10));
  // const querySnapshot = await getDocs(q);
  // ... 轉換格式回傳
  
  const saved = localStorage.getItem('2048_leaderboard');
  if (!saved) {
    // 預設提供一些有趣的 AI 挑戰者分數，豐富畫面的真實感
    const defaultList: LeaderboardEntry[] = [
      { id: '1', username: '超級AI拼圖王', score: 32480, steps: 1820, maxTile: 2048, timestamp: '2026/06/30' },
      { id: '2', username: '角落大師', score: 18450, steps: 1102, maxTile: 1024, timestamp: '2026/06/29' },
      { id: '3', username: '滑動高手阿明', score: 12450, steps: 840, maxTile: 1024, timestamp: '2026/06/28' }
    ];
    localStorage.setItem('2048_leaderboard', JSON.stringify(defaultList));
    return defaultList;
  }
  return JSON.parse(saved);
};
