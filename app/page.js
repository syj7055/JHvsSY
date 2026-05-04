'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// 1. 실제 게임 카드 덱 생성 함수 (총 28장)
const generateDeck = () => {
  const deck = [];
  const colors = ['Fear', 'Ruse', 'Manipulation'];
  colors.forEach(color => {
    for (let i = 1; i <= 8; i++) deck.push({ color, value: i });
  });
  for (let i = 3; i <= 6; i++) deck.push({ color: 'Potion', value: `${i}+` });
  
  // 피셔-예이츠 셔플
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

export default function GameRoom() {
  const [game, setGame] = useState(null);
  const [myRole, setMyRole] = useState(null);

  useEffect(() => {
    let channel;
    const fetchAndSubscribe = async () => {
      const { data } = await supabase.from('games').select('*').limit(1);
      let currentGameId;
      
      if (data && data.length > 0) {
        setGame(data[0]);
        currentGameId = data[0].id;
      } else {
        await initNewGame('Jekyll');
        return;
      }

      channel = supabase
        .channel('game-updates')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${currentGameId}` }, 
        (payload) => {
          setGame(payload.new);
        }).subscribe();
    };

    fetchAndSubscribe();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  // 새로운 게임 시작 (리셋) 로직
  const initNewGame = async (leader) => {
    const deck = generateDeck();
    const cityDeck = deck.splice(0, 8);
    const jekyllHand = deck.splice(0, 10);
    const hydeHand = deck.splice(0, 10);

    const initialGameState = {
      leader: leader,
      turn: leader, 
      currentTrick: [],
      playedTricks: [], 
      hands: { Jekyll: jekyllHand, Hyde: hydeHand },
      cityDeck: cityDeck,
      // ✨ 보드판 말 위치 상태 추가 (0부터 10까지 11칸)
      jhPosition: 0, 
      syPosition: 0,
    };

    if (game?.id) {
      await supabase.from('games').update({ game_state: initialGameState }).eq('id', game.id);
    } else {
      const { data: newData } = await supabase.from('games').insert([{ status: 'playing', game_state: initialGameState }]).select();
      if (newData) setGame(newData[0]);
    }
  };

  // 카드 디자인 
  const getCardStyle = (color) => {
    const themes = {
      Fear: { bg: '#0A2932', text: '#28A4DE' },
      Ruse: { bg: '#420207', text: '#FF7828' },
      Manipulation: { bg: '#121418', text: '#DAD9D3' },
      Potion: { bg: '#D5E1E5', text: '#FFBA36' }
    };
    const theme = themes[color] || { bg: '#FFFFFF', text: '#000000' };

    return {
      backgroundColor: theme.bg,
      color: theme.text,
      width: '80px',
      height: '120px',
      borderRadius: '8px',
      border: '2px solid rgba(0,0,0,0.2)',
      fontWeight: 'bold',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '2.5rem',
      cursor: 'pointer',
      boxShadow: '2px 4px 8px rgba(0,0,0,0.3)',
      transition: 'transform 0.1s',
      userSelect: 'none'
    };
  };

  // 턴 순서 계산 로직
  const getNextTurn = (currentTurn, leader) => {
    const cycle = leader === 'Jekyll' ? ['Jekyll', 'London', 'Hyde'] : ['Hyde', 'London', 'Jekyll'];
    const currentIndex = cycle.indexOf(currentTurn);
    return cycle[(currentIndex + 1) % 3];
  };

  // 플레이어 카드 내기
  const playCard = async (cardIndex) => {
    const state = game.game_state;
    if (state.turn !== myRole || state.currentTrick.length >= 3) return;

    const myHand = [...state.hands[myRole]];
    const playedCard = myHand.splice(cardIndex, 1)[0];
    
    const newTrick = [...state.currentTrick, { playedBy: myRole, card: playedCard }];
    const nextTurn = getNextTurn(state.turn, state.leader);

    await supabase.from('games').update({ 
      game_state: { ...state, hands: { ...state.hands, [myRole]: myHand }, currentTrick: newTrick, turn: nextTurn } 
    }).eq('id', game.id);
  };

  // 런던(City) 카드 내기
  const playLondonCard = async () => {
    const state = game.game_state;
    if (state.turn !== 'London' || state.cityDeck.length === 0) return;

    const newCityDeck = [...state.cityDeck];
    const playedCard = newCityDeck.shift(); 

    const newTrick = [...state.currentTrick, { playedBy: 'London', card: playedCard }];
    const nextTurn = getNextTurn(state.turn, state.leader);

    await supabase.from('games').update({ 
      game_state: { ...state, cityDeck: newCityDeck, currentTrick: newTrick, turn: nextTurn } 
    }).eq('id', game.id);
  };

  // 트릭 승자 판정
  const resolveTrick = async (winner) => {
    const state = game.game_state;
    const newPlayedTricks = [...state.playedTricks, { winner, trick: state.currentTrick }];
    
    await supabase.from('games').update({ 
      game_state: { ...state, playedTricks: newPlayedTricks, currentTrick: [], turn: winner }
    }).eq('id', game.id);
  };

  // ✨ 보드판 말 이동 로직
  const movePawn = async (pawnType, direction) => {
    const state = game.game_state;
    const currentPos = state[`${pawnType}Position`];
    let newPos = currentPos + direction;
    
    if (newPos < 0) newPos = 0;
    if (newPos > 10) newPos = 10; // 총 10칸(마지막 칸)까지만 이동

    await supabase.from('games').update({ 
      game_state: { ...state, [`${pawnType}Position`]: newPos } 
    }).eq('id', game.id);
  };

  if (!game) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;
  const state = game.game_state;

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #333', paddingBottom: '10px' }}>
        <h1 style={{ margin: 0 }}>Jekyll & Hyde vs Scotland Yard</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => initNewGame('Jekyll')} style={{ padding: '8px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reset (Jekyll Lead)</button>
          <button onClick={() => initNewGame('Hyde')} style={{ padding: '8px 12px', background: '#555', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reset (Hyde Lead)</button>
        </div>
      </div>
      
      {!myRole ? (
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <h2>Select Your Character</h2>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '2rem' }}>
            <button onClick={() => setMyRole('Jekyll')} style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '5px' }}>Dr. Jekyll</button>
            <button onClick={() => setMyRole('Hyde')} style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#555', color: 'white', border: 'none', borderRadius: '5px' }}>Mr. Hyde</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '1rem' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2>You are: {myRole} (Leader: {state.leader})</h2>
            <h2 style={{ color: state.turn === myRole ? '#27ae60' : '#c0392b' }}>
              {state.turn === myRole ? "👉 Your Turn!" : `Waiting for ${state.turn}...`}
            </h2>
          </div>

          {/* ✨ 그래픽 게임 보드판 영역 */}
          <div style={{ backgroundColor: 'rgba(255,255,255,0.4)', padding: '2rem', borderRadius: '10px', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, textAlign: 'center' }}>London City Track</h3>
            
            {/* 트랙 UI */}
            <div style={{ position: 'relative', margin: '3rem 0 2rem 0' }}>
              {/* 배경 연결 선 */}
              <div style={{ position: 'absolute', top: '50%', left: '0', right: '0', height: '4px', backgroundColor: '#8b7355', transform: 'translateY(-50%)', zIndex: 1 }}></div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((step) => (
                  <div key={step} style={{ width: '40px', height: '40px', backgroundColor: '#eaddcf', border: '3px solid #8b7355', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', color: '#8b7355', position: 'relative' }}>
                    {step === 0 ? 'S' : step === 10 ? 'End' : step}
                    
                    {/* Scotland Yard 말 (위쪽 표시) */}
                    {state.syPosition === step && (
                      <div style={{ position: 'absolute', top: '-35px', backgroundColor: '#c0392b', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
                        🚓 SY
                      </div>
                    )}
                    
                    {/* Jekyll & Hyde 말 (아래쪽 표시) */}
                    {state.jhPosition === step && (
                      <div style={{ position: 'absolute', bottom: '-35px', backgroundColor: '#2c3e50', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
                        🎩 J&H
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 보드판 말 이동 조작부 */}
            <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '1rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#c0392b' }}>Scotland Yard (SY)</div>
                <button onClick={() => movePawn('sy', -1)} style={{ padding: '5px 15px', marginRight: '5px', cursor: 'pointer' }}>◀ 뒤로</button>
                <button onClick={() => movePawn('sy', 1)} style={{ padding: '5px 15px', cursor: 'pointer' }}>앞으로 ▶</button>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#2c3e50' }}>Jekyll & Hyde (J&H)</div>
                <button onClick={() => movePawn('jh', -1)} style={{ padding: '5px 15px', marginRight: '5px', cursor: 'pointer' }}>◀ 뒤로</button>
                <button onClick={() => movePawn('jh', 1)} style={{ padding: '5px 15px', cursor: 'pointer' }}>앞으로 ▶</button>
              </div>
            </div>
          </div>

          {/* 과거 트릭 기록 */}
          <div style={{ backgroundColor: 'rgba(255,255,255,0.3)', padding: '1.5rem', borderRadius: '10px' }}>
            <h3 style={{ marginTop: 0 }}>Played Tricks History</h3>
            <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '10px' }}>
              {state.playedTricks.length === 0 && <span style={{ color: '#666' }}>No tricks played yet.</span>}
              {state.playedTricks.map((pt, idx) => (
                <div key={idx} style={{ minWidth: '150px', backgroundColor: 'rgba(0,0,0,0.1)', padding: '10px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Trick {idx + 1}<br/>Winner: {pt.winner}</div>
                  <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                    {pt.trick.map((t, i) => (
                      <div key={i} title={t.playedBy} style={{ ...getCardStyle(t.card.color), width: '30px', height: '45px', fontSize: '1rem', padding: 0 }}>
                        {t.card.value}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 현재 진행 중인 트릭 */}
          <div style={{ padding: '2rem', backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: '10px', minHeight: '200px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>Current Trick</h3>
              {state.turn === 'London' && state.currentTrick.length < 3 && (
                <button onClick={playLondonCard} style={{ padding: '10px 20px', fontSize: '1rem', backgroundColor: '#e67e22', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
                  Reveal London's Card
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', minHeight: '150px', alignItems: 'center' }}>
              {state.currentTrick.map((t, idx) => (
                <div key={idx} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.1rem', marginBottom: '8px', fontWeight: 'bold' }}>{t.playedBy}</div>
                  <div style={getCardStyle(t.card.color)}>
                    {t.card.value}
                  </div>
                </div>
              ))}
            </div>

            {state.currentTrick.length === 3 && (
              <div style={{ textAlign: 'center', marginTop: '2rem', padding: '1rem', backgroundColor: '#ffeaa7', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 10px 0' }}>Who won this trick? (상의 후 클릭)</h4>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                  <button onClick={() => resolveTrick('Jekyll')} style={{ padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>Jekyll Won</button>
                  <button onClick={() => resolveTrick('London')} style={{ padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>London Won</button>
                  <button onClick={() => resolveTrick('Hyde')} style={{ padding: '8px 16px', cursor: 'pointer', fontWeight: 'bold' }}>Hyde Won</button>
                </div>
              </div>
            )}
          </div>

          {/* 내 손패 */}
          <div style={{ marginBottom: '2rem' }}>
            <h3>Your Hand (Hidden from opponent)</h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {state.hands[myRole]?.length === 0 && <p>No cards left.</p>}
              {state.hands[myRole]?.map((card, idx) => (
                <div 
                  key={idx} 
                  onClick={() => playCard(idx)}
                  style={{ ...getCardStyle(card.color), opacity: (state.turn === myRole && state.currentTrick.length < 3) ? 1 : 0.5 }}
                >
                  {card.value}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}