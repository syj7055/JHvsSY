'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// 덱 생성 (총 28장)
const generateDeck = () => {
  const deck = [];
  const colors = ['Fear', 'Ruse', 'Manipulation'];
  colors.forEach(color => {
    for (let i = 1; i <= 8; i++) deck.push({ color, value: i });
  });
  for (let i = 3; i <= 6; i++) deck.push({ color: 'Potion', value: `${i}+` });
  
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

export default function GameRoom() {
  const [game, setGame] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [selectedForCity, setSelectedForCity] = useState([]); 
  const [exchangeMode, setExchangeMode] = useState(false);

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
        (payload) => setGame(payload.new)).subscribe();
    };

    fetchAndSubscribe();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  // 라운드 리셋 (트랙 위치는 그대로 유지)
  const initNewGame = async (leader) => {
    const deck = generateDeck();
    const jekyllHand = deck.splice(0, 12);
    const hydeHand = deck.splice(0, 12);

    // 이전 게임이 있다면 트랙 위치 보존
    const currentJh = game?.game_state?.jhPosition !== undefined ? game.game_state.jhPosition : 2;
    const currentSy = game?.game_state?.syPosition !== undefined ? game.game_state.syPosition : 0;

    const initialGameState = {
      leader: leader,
      turn: leader,
      phase: 'give_cards',
      currentTrick: [],
      playedTricks: { Jekyll: [], Hyde: [], London: [] },
      hands: { Jekyll: jekyllHand, Hyde: hydeHand },
      cityDeck: [],
      givenToCity: { Jekyll: [], Hyde: [] },
      rankSlots: [null, null, null],
      unassignedSuits: ['Fear', 'Ruse', 'Manipulation'],
      jhPosition: currentJh, 
      syPosition: currentSy,
    };

    if (game?.id) {
      await supabase.from('games').update({ game_state: initialGameState }).eq('id', game.id);
    } else {
      const { data: newData } = await supabase.from('games').insert([{ status: 'playing', game_state: initialGameState }]).select();
      if (newData) setGame(newData[0]);
    }
    setSelectedForCity([]); // 내 선택 초기화
  };

  // 트랙만 리셋 (라운드는 그대로)
  const resetTrackOnly = async () => {
    if (!game) return;
    await supabase.from('games').update({ 
      game_state: { ...game.game_state, jhPosition: 2, syPosition: 0 } 
    }).eq('id', game.id);
  };

  // 런던에게 4장 주기 (동시 제출 버그 완벽 해결)
  const confirmGiveCards = async () => {
    if (selectedForCity.length !== 4) return;
    
    // DB의 최신 상태를 강제로 다시 읽어와서 병합 (Race Condition 방지)
    const { data } = await supabase.from('games').select('game_state').eq('id', game.id).single();
    if (!data) return;
    let state = data.game_state;
    
    const myHand = [...state.hands[myRole]];
    const cardsToGive = selectedForCity.map(idx => myHand[idx]);
    
    state.hands[myRole] = myHand.filter((_, idx) => !selectedForCity.includes(idx));
    state.givenToCity[myRole] = cardsToGive;

    const otherRole = myRole === 'Jekyll' ? 'Hyde' : 'Jekyll';
    
    // 상대방이 이미 줬다면 합치고 시작
    if (state.givenToCity[otherRole] && state.givenToCity[otherRole].length === 4) {
      let combined = [...state.givenToCity[myRole], ...state.givenToCity[otherRole]];
      combined.sort(() => Math.random() - 0.5); // 셔플
      state.cityDeck = combined;
      state.phase = 'playing';
    }

    await supabase.from('games').update({ game_state: state }).eq('id', game.id);
    setSelectedForCity([]);
  };

  const getNextTurn = (currentTurn, leader) => {
    const cycle = leader === 'Jekyll' ? ['Jekyll', 'London', 'Hyde'] : ['Hyde', 'London', 'Jekyll'];
    const currentIndex = cycle.indexOf(currentTurn);
    return cycle[(currentIndex + 1) % 3];
  };

  const playOrExchangeCard = async (cardIndex) => {
    const state = { ...game.game_state };
    const myHand = [...state.hands[myRole]];

    if (exchangeMode) {
      if (state.cityDeck.length === 0) return;
      const clickedCard = myHand[cardIndex];
      const topCityCard = state.cityDeck[0];
      
      myHand[cardIndex] = topCityCard;
      state.cityDeck[0] = clickedCard;
      state.hands[myRole] = myHand;
      
      await supabase.from('games').update({ game_state: state }).eq('id', game.id);
      setExchangeMode(false);
      return;
    }

    if (state.turn !== myRole || state.currentTrick.length >= 3) return;
    
    const playedCard = myHand.splice(cardIndex, 1)[0];
    const newTrick = [...state.currentTrick, { playedBy: myRole, card: playedCard }];
    const nextTurn = getNextTurn(state.turn, state.leader);

    state.hands[myRole] = myHand;
    state.currentTrick = newTrick;
    state.turn = nextTurn;

    await supabase.from('games').update({ game_state: state }).eq('id', game.id);
  };

  const playLondonCard = async () => {
    const state = { ...game.game_state };
    if (state.turn !== 'London' || state.cityDeck.length === 0) return;

    const playedCard = state.cityDeck.shift(); 
    const newTrick = [...state.currentTrick, { playedBy: 'London', card: playedCard }];
    const nextTurn = getNextTurn(state.turn, state.leader);

    state.currentTrick = newTrick;
    state.turn = nextTurn;

    await supabase.from('games').update({ game_state: state }).eq('id', game.id);
  };

  const resolveTrick = async (winner) => {
    const state = { ...game.game_state };
    state.playedTricks[winner].push(state.currentTrick);
    state.currentTrick = [];
    state.turn = winner; 
    await supabase.from('games').update({ game_state: state }).eq('id', game.id);
  };

  const handleDragStart = (e, type, payload) => {
    e.dataTransfer.setData('type', type);
    e.dataTransfer.setData('payload', JSON.stringify(payload));
  };

  const handleDrop = async (e, targetType, targetPayload) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    const payload = JSON.parse(e.dataTransfer.getData('payload') || '{}');
    const state = { ...game.game_state };

    if (type === 'pawn' && targetType === 'track') {
      state[`${payload.pawn}Position`] = targetPayload.index;
      await supabase.from('games').update({ game_state: state }).eq('id', game.id);
    }
    
    if (type === 'london_trick' && targetType === 'player_tricks' && (targetPayload.target === 'Jekyll' || targetPayload.target === 'Hyde')) {
      const trickToMove = state.playedTricks.London.pop(); 
      if (trickToMove) {
        state.playedTricks[targetPayload.target].push(trickToMove);
        await supabase.from('games').update({ game_state: state }).eq('id', game.id);
      }
    }

    if (type === 'suit' && targetType === 'rank') {
      const { fromSlot, suit } = payload;
      const toSlot = targetPayload.index;

      if (fromSlot === 'unassigned') state.unassignedSuits = state.unassignedSuits.filter(s => s !== suit);
      else state.rankSlots[fromSlot] = null;

      if (toSlot !== 'unassigned' && state.rankSlots[toSlot]) {
        const existing = state.rankSlots[toSlot];
        if (fromSlot === 'unassigned') state.unassignedSuits.push(existing);
        else state.rankSlots[fromSlot] = existing;
      }

      if (toSlot === 'unassigned') state.unassignedSuits.push(suit);
      else state.rankSlots[toSlot] = suit;

      await supabase.from('games').update({ game_state: state }).eq('id', game.id);
    }
  };

  // 실제 카드용 원본 색상
  const getCardStyle = (color, isDisabled = false, isSelected = false) => {
    const themes = {
      Fear: { bg: '#0A2932', text: '#28A4DE' },
      Ruse: { bg: '#420207', text: '#FF7828' },
      Manipulation: { bg: '#121418', text: '#DAD9D3' },
      Potion: { bg: '#D5E1E5', text: '#FFBA36' }
    };
    const t = themes[color] || { bg: '#FFF', text: '#000' };

    return {
      position: 'relative',
      backgroundColor: t.bg,
      color: t.text,
      width: '50px', height: '75px', 
      borderRadius: '6px',
      border: isSelected ? '3px solid #27ae60' : '2px solid rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '1.6rem', fontWeight: 'bold',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.3 : 1,
      boxShadow: '1px 2px 4px rgba(0,0,0,0.3)',
      userSelect: 'none'
    };
  };

  // 수트 랭크 원형 아이콘 전용 색상
  const getRankCircleColor = (suit) => {
    const colors = { Fear: '#35A5DC', Ruse: '#FF7628', Manipulation: '#343A35' };
    return colors[suit] || '#ccc';
  };

  const renderCard = (card, isDisabled = false, isSelected = false, onClick = null) => {
    if (!card) return null;
    return (
      <div style={getCardStyle(card.color, isDisabled, isSelected)} onClick={onClick}>
        {card.value}
      </div>
    );
  };

  if (!game) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading</div>;
  const state = game.game_state;

  if (!myRole) {
    return (
      <div style={{ textAlign: 'center', marginTop: '3rem' }}>
        <h2>Select Your Character</h2>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '2rem' }}>
          <button onClick={() => setMyRole('Jekyll')} style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#333', color: 'white' }}>Dr. Jekyll</button>
          <button onClick={() => setMyRole('Hyde')} style={{ padding: '15px 30px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#555', color: 'white' }}>Mr. Hyde</button>
        </div>
      </div>
    );
  }

  // Phase 1: 카드 12장 분배 -> 4장 선택 (6x2 그리드 배열)
  if (state.phase === 'give_cards') {
    return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <h2>Select 4 cards to give to London</h2>
        <p>Waiting for opponent status: {state.givenToCity[myRole === 'Jekyll' ? 'Hyde' : 'Jekyll']?.length === 4 ? "Ready" : "Selecting"}</p>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(6, 1fr)', 
          gap: '10px', 
          justifyItems: 'center',
          margin: '2rem auto' 
        }}>
          {state.hands[myRole].map((card, idx) => {
            const isSelected = selectedForCity.includes(idx);
            return (
              <div key={idx}>
                {renderCard(card, false, isSelected, () => {
                  if (isSelected) setSelectedForCity(prev => prev.filter(i => i !== idx));
                  else if (selectedForCity.length < 4) setSelectedForCity(prev => [...prev, idx]);
                })}
              </div>
            );
          })}
        </div>
        <button onClick={confirmGiveCards} disabled={selectedForCity.length !== 4} style={{ padding: '10px 20px', fontSize: '1.2rem', cursor: 'pointer' }}>Confirm 4 Cards</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', boxSizing: 'border-box', overflow: 'hidden', padding: '1rem', gap: '1rem' }}>
      
      {/* 헤더 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid rgba(0,0,0,0.2)', paddingBottom: '10px' }}>
        <h2 style={{ margin: 0 }}>You are {myRole}</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => initNewGame('Jekyll')} style={{ padding: '6px 12px', background: '#333', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>New Round (Jekyll Lead)</button>
          <button onClick={() => initNewGame('Hyde')} style={{ padding: '6px 12px', background: '#555', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>New Round (Hyde Lead)</button>
        </div>
        <h2 style={{ margin: 0, fontWeight: 'normal' }}>
          {state.turn === myRole ? "Your turn" : `Waiting for ${state.turn}`}
        </h2>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flex: 1, overflow: 'hidden' }}>
        
        {/* ===== MAIN COLUMN (좌측 65%) ===== */}
        <div style={{ width: '65%', display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
          
          {/* 상단: Current Trick & Suit Rank */}
          <div style={{ display: 'flex', gap: '1rem', flexShrink: 0 }}>
            <div style={{ flex: 3.5, backgroundColor: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '8px', minHeight: '160px' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                 <h3 style={{ margin: 0 }}>Current Trick</h3>
                 {state.turn === 'London' && state.currentTrick.length < 3 && (
                   <button onClick={playLondonCard} style={{ padding: '5px 10px', backgroundColor: '#e67e22', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reveal London</button>
                 )}
               </div>
               <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '1rem' }}>
                 {state.currentTrick.map((t, idx) => (
                   <div key={idx} style={{ textAlign: 'center' }}>
                     <div style={{ fontSize: '0.9rem', marginBottom: '5px' }}>{t.playedBy}</div>
                     {renderCard(t.card)}
                   </div>
                 ))}
               </div>
               {state.currentTrick.length === 3 && (
                  <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <button onClick={() => resolveTrick('Jekyll')}>Jekyll Won</button>
                    <button onClick={() => resolveTrick('London')} style={{ margin: '0 10px' }}>London Won</button>
                    <button onClick={() => resolveTrick('Hyde')}>Hyde Won</button>
                  </div>
               )}
            </div>

            <div style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', padding: '1rem', borderRadius: '8px', display: 'flex' }}>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                  <h4 style={{ margin: 0 }}>Rank</h4>
                  {[0, 1, 2].map((slotIndex) => (
                    <div key={slotIndex} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'rank', { index: slotIndex })}
                         style={{ width: '35px', height: '35px', border: '2px dashed #666', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {state.rankSlots[slotIndex] && (
                        <div draggable onDragStart={e => handleDragStart(e, 'suit', { fromSlot: slotIndex, suit: state.rankSlots[slotIndex] })}
                             style={{ width: '100%', height: '100%', borderRadius: '50%', backgroundColor: getRankCircleColor(state.rankSlots[slotIndex]) }} />
                      )}
                    </div>
                  ))}
               </div>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', borderLeft: '1px solid #ccc' }}>
                  <h4 style={{ margin: 0 }}>Unassigned</h4>
                  <div onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'rank', { index: 'unassigned' })} style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                    {state.unassignedSuits.map(suit => (
                      <div key={suit} draggable onDragStart={e => handleDragStart(e, 'suit', { fromSlot: 'unassigned', suit })}
                           style={{ width: '35px', height: '35px', borderRadius: '50%', backgroundColor: getRankCircleColor(suit), cursor: 'grab' }} />
                    ))}
                  </div>
               </div>
            </div>
          </div>

          {/* 중단: 획득한 트릭들 (크기 대폭 키움, 2 Column 레이아웃 적용) */}
          <div style={{ display: 'flex', gap: '1rem', flex: 1, minHeight: '300px' }}>
            {['Jekyll', 'London', 'Hyde'].map(owner => (
              <div key={owner} 
                   onDragOver={e => e.preventDefault()} 
                   onDrop={e => handleDrop(e, 'player_tricks', { target: owner })}
                   style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.05)', padding: '10px', borderRadius: '8px', overflowY: 'auto' }}>
                <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>{owner} Tricks</h4>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignContent: 'start' }}>
                  {state.playedTricks[owner].map((trickArr, idx) => {
                    const isLastLondonTrick = owner === 'London' && idx === state.playedTricks.London.length - 1;
                    return (
                      <div key={idx} 
                           draggable={isLastLondonTrick}
                           onDragStart={e => isLastLondonTrick && handleDragStart(e, 'london_trick', {})}
                           style={{ display: 'flex', gap: '2px', padding: '4px', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: '4px', cursor: isLastLondonTrick ? 'grab' : 'default', justifyContent: 'center' }}>
                        {trickArr.map((t, i) => <div key={i} style={{...getCardStyle(t.card.color), width: '22px', height: '32px', fontSize: '1rem', borderWidth: '1px'}}>{t.card.value}</div>)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 하단: 내 손패 (크기 축소) */}
          <div style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.8rem', borderRadius: '8px', flexShrink: 0 }}>
            <h4 style={{ margin: '0 0 5px 0' }}>My Hand</h4>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
               {state.hands[myRole].map((card, idx) => renderCard(card, state.turn !== myRole && !exchangeMode, false, () => playOrExchangeCard(idx)))}
            </div>
          </div>
        </div>

        {/* ===== SIDE COLUMN (우측 35%) ===== */}
        <div style={{ width: '35%', display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: '2px solid rgba(0,0,0,0.1)', paddingLeft: '1rem', height: '100%', overflowY: 'auto' }}>
          
          {/* 1영역: 트랙 (높이 1.5배 증가, 리셋버튼 상단 배치) */}
          <div style={{ backgroundColor: 'rgba(255,255,255,0.4)', padding: '3rem 1rem 4rem 1rem', borderRadius: '8px', position: 'relative' }}>
            <button onClick={resetTrackOnly} style={{ position: 'absolute', top: '10px', right: '10px', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer' }}>Reset Track</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', marginTop: '20px' }}>
               <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '4px', backgroundColor: '#8b7355', zIndex: 1 }} />
               {[0,1,2,3,4,5,6,7,8,9,10].map(step => {
                  let text = '';
                  if (step === 2) text = 'I'; else if (step === 3) text = 'II'; else if (step === 4) text = 'III'; else if (step === 5) text = 'IV';
                  return (
                    <div key={step} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'track', { index: step })}
                         style={{ width: '30px', height: '30px', backgroundColor: '#eaddcf', border: '3px solid #8b7355', borderRadius: '50%', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                      {text}
                      {state.syPosition === step && <div draggable onDragStart={e=>handleDragStart(e, 'pawn', {pawn: 'sy'})} style={{position:'absolute', top:'-30px', background:'#1B375E', color:'#fff', padding:'4px 8px', borderRadius:'4px', fontSize:'0.8rem', cursor:'grab'}}>SY</div>}
                      {state.jhPosition === step && <div draggable onDragStart={e=>handleDragStart(e, 'pawn', {pawn: 'jh'})} style={{position:'absolute', bottom:'-30px', background:'#333636', color:'#fff', padding:'4px 8px', borderRadius:'4px', fontSize:'0.8rem', cursor:'grab'}}>JH</div>}
                    </div>
                  );
               })}
            </div>
          </div>

          {/* 2영역: 카드 그리드 Tracker (박스 비율 고정, London 제출카드 제외) */}
          <div style={{ backgroundColor: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '8px' }}>
             <h4 style={{ margin: '0 0 10px 0' }}>Card Tracker</h4>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
               {['Fear', 'Ruse', 'Manipulation', 'Potion'].map(color => {
                 const isPotion = color === 'Potion';
                 const startVal = isPotion ? 3 : 1;
                 const endVal = isPotion ? 6 : 8;
                 return (
                   <div key={color} style={{ display: 'flex', gap: '6px' }}>
                     {isPotion && <div style={{ width: '88px', flexShrink: 0 }}></div>} {/* 앞칸 2개 + 갭 비우기 */}
                     {Array.from({length: endVal - startVal + 1}, (_, i) => i + startVal).map(val => {
                       const valueStr = isPotion ? `${val}+` : val;
                       const allPlayed = [...state.playedTricks.Jekyll, ...state.playedTricks.Hyde, ...state.playedTricks.London].flat();
                       
                       // 런던 제출 카드는 활성화 유지
                       const isUsed = state.hands[myRole].some(c => c.color === color && c.value == valueStr) ||
                                      state.currentTrick.some(t => t.card.color === color && t.card.value == valueStr) ||
                                      allPlayed.some(t => t.card.color === color && t.card.value == valueStr);
                       return (
                         <div key={val} style={{ ...getCardStyle(color, isUsed), width: '40px', height: '50px', fontSize: '1.2rem', flexShrink: 0 }}>
                           {valueStr}
                         </div>
                       );
                     })}
                   </div>
                 );
               })}
             </div>
          </div>

          {/* 3영역 & 런던 덱 교환 (높이 축소) */}
          <div style={{ backgroundColor: 'rgba(255,255,255,0.3)', padding: '0.8rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <h4 style={{ margin: '0 0 5px 0' }}>Cards Given to London</h4>
              <div style={{ display: 'flex', gap: '5px' }}>
                {state.givenToCity[myRole].map((c, i) => <div key={i} style={{...getCardStyle(c.color), width:'35px', height:'50px', fontSize:'1rem'}}>{c.value}</div>)}
              </div>
            </div>

            <div style={{ textAlign: 'center', padding: '0.8rem', backgroundColor: exchangeMode ? '#ffeaa7' : 'transparent', border: '1px dashed #333' }}>
              <h4 style={{ margin: '0 0 5px 0' }}>London Deck ({state.cityDeck.length} left)</h4>
              {exchangeMode ? (
                 <p style={{ margin: 0, fontSize: '0.9rem', color: '#d35400' }}>Select a card to exchange, or <span onClick={() => setExchangeMode(false)} style={{ textDecoration: 'underline', cursor: 'pointer' }}>Cancel</span></p>
              ) : (
                 <button onClick={() => setExchangeMode(true)} disabled={state.cityDeck.length === 0} style={{ padding: '5px 10px' }}>Exchange Card</button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}