'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function GameRoom() {
  const [game, setGame] = useState(null);
  const [myRole, setMyRole] = useState(null); // 'Jekyll' or 'Hyde'

  useEffect(() => {
    let channel;

    const fetchAndSubscribe = async () => {
      // 1. 방 찾기 (없으면 새로 만듦)
      let currentGameId;
      const { data } = await supabase.from('games').select('*').limit(1);
      
      if (data && data.length > 0) {
        setGame(data[0]);
        currentGameId = data[0].id;
      } else {
        const initialGameState = {
          turn: 'Jekyll',
          currentTrick: [],
          hands: {
            Jekyll: [{ color: 'Fear', value: 3 }, { color: 'Potion', value: 5 }],
            Hyde: [{ color: 'Ruse', value: 5 }, { color: 'Manipulation', value: 1 }],
          },
          cityDeck: [{ color: 'Potion', value: 4 }],
        };
        const { data: newData } = await supabase.from('games').insert([{ status: 'playing', game_state: initialGameState }]).select();
        if (newData) {
          setGame(newData[0]);
          currentGameId = newData[0].id;
        }
      }

      // 2. 해당 방 실시간 구독
      channel = supabase
        .channel('game-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${currentGameId}` }, 
        (payload) => {
          setGame(payload.new);
        }).subscribe();
    };

    fetchAndSubscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // 카드 색상 테마 적용 함수
  const getCardStyle = (color) => {
    const themes = {
      Fear: { bg: '#0A2932', text: '#28A4DE' },
      Ruse: { bg: '#420207', text: '#FF7828' },
      Manipulation: { bg: '#121418', text: '#DAD9D3' },
      Potion: { bg: '#D5E1E5', text: '#FFDF3E' }
    };
    
    const theme = themes[color] || { bg: '#FFFFFF', text: '#000000' };

    return {
      backgroundColor: theme.bg,
      color: theme.text,
      padding: '20px',
      borderRadius: '8px',
      border: '2px solid rgba(0,0,0,0.2)',
      fontWeight: 'bold',
      fontSize: '1.2rem',
      minWidth: '60px',
      textAlign: 'center',
      cursor: 'pointer',
      boxShadow: '2px 4px 8px rgba(0,0,0,0.3)',
      transition: 'transform 0.1s'
    };
  };

  const playCard = async (cardIndex) => {
    if (!game || !myRole) return;
    const state = game.game_state;
    
    if (state.turn !== myRole) {
      alert("It's not your turn!");
      return;
    }

    const myHand = [...state.hands[myRole]];
    const playedCard = myHand.splice(cardIndex, 1)[0];
    const newTrick = [...state.currentTrick, { playedBy: myRole, card: playedCard }];
    const nextTurn = myRole === 'Jekyll' ? 'Hyde' : 'Jekyll';

    const newState = {
      ...state,
      hands: { ...state.hands, [myRole]: myHand },
      currentTrick: newTrick,
      turn: nextTurn,
    };

    await supabase.from('games').update({ game_state: newState }).eq('id', game.id);
  };

  if (!game) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;

  const state = game.game_state;

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px' }}>
        Jekyll & Hyde vs Scotland Yard
      </h1>
      
      {!myRole ? (
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <h2>Select Your Character</h2>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '2rem' }}>
            <button onClick={() => setMyRole('Jekyll')} style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '5px' }}>
              Dr. Jekyll
            </button>
            <button onClick={() => setMyRole('Hyde')} style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#555', color: 'white', border: 'none', borderRadius: '5px' }}>
              Mr. Hyde
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
            <h2>You are: {myRole}</h2>
            <h3 style={{ color: state.turn === myRole ? '#27ae60' : '#c0392b' }}>
              {state.turn === myRole ? "Your Turn" : "Waiting for opponent..."}
            </h3>
          </div>

          {/* 중앙 트릭 영역 */}
          <div style={{ margin: '3rem 0', padding: '2rem', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '10px', minHeight: '150px' }}>
            <h3 style={{ marginTop: 0 }}>Current Trick</h3>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              {state.currentTrick.map((t, idx) => (
                <div key={idx} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.9rem', marginBottom: '5px', fontWeight: 'bold' }}>{t.playedBy}</div>
                  <div style={getCardStyle(t.card.color)}>
                    <div>{t.card.color}</div>
                    <div style={{ fontSize: '2rem' }}>{t.card.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 내 손패 영역 */}
          <div>
            <h3>Your Hand</h3>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              {state.hands[myRole]?.map((card, idx) => (
                <div 
                  key={idx} 
                  onClick={() => playCard(idx)}
                  style={{ ...getCardStyle(card.color), opacity: state.turn === myRole ? 1 : 0.6 }}
                >
                  <div style={{ fontSize: '0.8rem' }}>{card.color}</div>
                  <div style={{ fontSize: '1.8rem' }}>{card.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}