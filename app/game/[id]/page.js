'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function GameRoom({ params }) {
  const [game, setGame] = useState(null);
  const [myPlayerRole, setMyPlayerRole] = useState(null); // 'player1' or 'player2'
  const gameId = params.id;

  useEffect(() => {
    // 1. 초기 데이터 불러오기
    fetchGame();

    // 2. Supabase Realtime 구독 설정 (데이터베이스 변경 감지)
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          console.log('상태 업데이트 됨!', payload.new);
          setGame(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  const fetchGame = async () => {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();
    
    if (data) setGame(data);
  };

  const joinGame = async (role) => {
    // 실제 구현에서는 사용자 인증/세션을 붙여서 처리하지만 임시로 버튼 클릭으로 역할 부여
    setMyPlayerRole(role);
    await supabase
      .from('games')
      .update({ status: 'playing' })
      .eq('id', gameId);
  };

  // 카드 제출 (트릭 테이킹 로직의 뼈대)
  const playCard = async (cardIndex) => {
    if (!game || !myPlayerRole) return;
    const state = game.game_state;
    
    if (state.turn !== myPlayerRole) {
      alert('당신의 턴이 아닙니다!');
      return;
    }

    // 내 손에서 카드 빼기
    const myHand = [...state.hands[myPlayerRole]];
    const playedCard = myHand.splice(cardIndex, 1)[0];

    // 중앙 트릭에 카드 추가
    const newTrick = [...state.currentTrick, { playedBy: myPlayerRole, card: playedCard }];
    
    // 턴 넘기기 (player1 -> player2 -> player1)
    const nextTurn = myPlayerRole === 'player1' ? 'player2' : 'player1';

    // 변경된 상태를 DB에 덮어쓰기 (Realtime이 이 변경을 감지하고 양쪽 화면에 뿌려줌)
    const newState = {
      ...state,
      hands: {
        ...state.hands,
        [myPlayerRole]: myHand,
      },
      currentTrick: newTrick,
      turn: nextTurn,
    };

    await supabase
      .from('games')
      .update({ game_state: newState })
      .eq('id', gameId);
  };

  if (!game) return <div>로딩 중...</div>;

  const state = game.game_state;

  return (
    <div style={{ padding: '2rem' }}>
      <h2>게임 룸: {gameId}</h2>
      
      {!myPlayerRole ? (
        <div>
          <h3>역할 선택 (테스트용)</h3>
          <button onClick={() => joinGame('player1')}>Player 1 (지킬)로 참가</button>
          <button onClick={() => joinGame('player2')}>Player 2 (하이드)로 참가</button>
        </div>
      ) : (
        <div>
          <h3 style={{ color: state.turn === myPlayerRole ? 'green' : 'red' }}>
            현재 턴: {state.turn} {state.turn === myPlayerRole ? '(내 턴)' : '(상대 대기)'}
          </h3>

          <div style={{ margin: '2rem 0', padding: '1rem', border: '1px solid black' }}>
            <h3>중앙 트릭 (제출된 카드들)</h3>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {state.currentTrick.map((t, idx) => (
                <div key={idx} style={{ padding: '1rem', border: '1px solid gray' }}>
                  {t.playedBy}: {t.card.color} {t.card.value}
                </div>
              ))}
            </div>
            {/* 여기에 나중에 트릭의 승패를 계산하고 초기화하는 버튼/로직이 추가되어야 합니다 */}
          </div>

          <div>
            <h3>내 손패 ({myPlayerRole})</h3>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {state.hands[myPlayerRole]?.map((card, idx) => (
                <button 
                  key={idx} 
                  onClick={() => playCard(idx)}
                  disabled={state.turn !== myPlayerRole}
                  style={{ padding: '1rem 2rem', fontSize: '1.2rem', cursor: 'pointer' }}
                >
                  {card.color} {card.value}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}