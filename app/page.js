'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Lobby() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const createGame = async () => {
    setLoading(true);
    // 초기 게임 상태 (임시 데이터)
    const initialGameState = {
      turn: 'player1',
      currentTrick: [],
      hands: {
        player1: [{ color: 'red', value: 3 }, { color: 'blue', value: 8 }],
        player2: [{ color: 'red', value: 5 }, { color: 'black', value: 1 }],
      },
      cityDeck: [{ color: 'potion', value: 4 }], // 예시
    };

    const { data, error } = await supabase
      .from('games')
      .insert([
        {
          status: 'waiting',
          game_state: initialGameState,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('방 생성 에러:', error);
      setLoading(false);
      return;
    }

    // 방이 생성되면 해당 게임 룸으로 이동
    router.push(`/game/${data.id}`);
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>지킬 앤 하이드 vs 스코틀랜드 야드</h1>
      <p>온라인 멀티플레이 로비</p>
      <button 
        onClick={createGame} 
        disabled={loading}
        style={{ padding: '10px 20px', fontSize: '1rem', cursor: 'pointer' }}
      >
        {loading ? '생성 중...' : '새 게임 방 만들기'}
      </button>
    </div>
  );
}