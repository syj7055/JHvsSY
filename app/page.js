'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

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

  const initNewGame = async (leader) => {
    const deck = generateDeck();
    const jekyllHand = deck.splice(0, 12);
    const hydeHand = deck.splice(0, 12);

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
    setSelectedForCity([]); 
  };

  const resetTrackOnly = async () => {
    if (!game) return;
    await supabase.from('games').update({ 
      game_state: { ...game.game_state, jhPosition: 2, syPosition: 0 } 
    }).eq('id', game.id);
  };

  const confirmGiveCards = async () => {
    if (selectedForCity.length !== 4) return;
    
    const { data } = await supabase.from('games').select('game_state').eq('id', game.id).single();
    if (!data) return;
    let state = data.game_state;
    
    const myHand = [...state.hands[myRole]];
    const cardsToGive = selectedForCity.map(idx => myHand[idx]);
    
    state.hands[myRole] = myHand.filter((_, idx) => !selectedForCity.includes(idx));
    state.givenToCity[myRole] = cardsToGive;

    const otherRole = myRole === 'Jekyll' ? 'Hyde' : 'Jekyll';
    
    if (state.givenToCity[otherRole] && state.givenToCity[otherRole].length === 4) {
      let combined = [...state.givenToCity[myRole], ...state.givenToCity[otherRole]];
      combined.sort(() => Math.random() - 0.5); 
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

  // ✅ 오리지널 카드 색상 (롤백 완료)
  const getCardStyle = (color, isDisabled = false, isSelected = false) => {
    const themes = {
      Fear: { bg: '#0A2932', text: '#28A4DE' },
      Ruse: { bg: '#420207', text: '#FF7828' },
      Manipulation: { bg: '#121418', text: '#DAD9D3' },
      Potion: { bg: '#D5E1E5', text: '#FFBA36' }
    };
    const t = themes[color] || { bg: '#FFF', text: '#000' };

    return {
      backgroundColor: t.bg,
      color: t.text,
      borderRadius: '0.6vmin',
      border: isSelected ? '0.4vmin solid #27ae60' : '0.2vmin solid rgba(0,0,0,0.3)',
      boxShadow: '0.2vmin 0.3vmin 0.5vmin rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 'bold',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.3 : 1,
      userSelect: 'none',
      boxSizing: 'border-box'
    };
  };

  // ✅ Rank 전용 색상 지정 (새로 요청하신 컬러)
  const getRankCircleColor = (suit) => {
    const colors = { Fear: '#35A5DC', Ruse: '#FF7628', Manipulation: '#343A35' };
    return colors[suit] || '#ccc';
  };

  // ✅ 궁극의 카드 렌더링 함수 (어떤 컨테이너에 들어가도 완벽히 비율 유지 & 폰트 크기 자동 조절)
  const renderCard = (card, isDisabled = false, isSelected = false, onClick = null) => {
    if (!card) return null;
    return (
      <div style={{ 
        width: '100%', height: '100%', 
        display: 'flex', justifyContent: 'center', alignItems: 'center', 
        minWidth: 0, minHeight: 0 
      }}>
        <div onClick={onClick} style={{ 
          ...getCardStyle(card.color, isDisabled, isSelected),
          maxHeight: '100%', maxWidth: '100%', 
          aspectRatio: '2/3', 
          containerType: 'size', // 카드 내부 상대적 폰트 크기 조절용
        }}>
          <span style={{ fontSize: '45cqh', pointerEvents: 'none' }}>{card.value}</span>
        </div>
      </div>
    );
  };

  if (!game) return <div style={{ padding: '2vmin', textAlign: 'center', fontSize: '3vmin' }}>Loading</div>;
  const state = game.game_state;

  if (!myRole) {
    return (
      <div style={{ textAlign: 'center', marginTop: '5vmin' }}>
        <h2 style={{ fontSize: '4vmin' }}>Select Your Character</h2>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '2vmin', marginTop: '2vmin' }}>
          <button onClick={() => setMyRole('Jekyll')} style={{ padding: '2vmin 3vmin', fontSize: '2vmin', cursor: 'pointer', backgroundColor: '#333', color: 'white', borderRadius: '1vmin' }}>Dr. Jekyll</button>
          <button onClick={() => setMyRole('Hyde')} style={{ padding: '2vmin 3vmin', fontSize: '2vmin', cursor: 'pointer', backgroundColor: '#555', color: 'white', borderRadius: '1vmin' }}>Mr. Hyde</button>
        </div>
      </div>
    );
  }

  // Phase 1: 카드 12장 분배 -> 4장 선택 (6x2 그리드 배열 완벽 적용)
  if (state.phase === 'give_cards') {
    return (
      <div style={{ padding: '2vmin', width: '80vw', height: '90vh', margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h2 style={{ fontSize: '3.5vmin', margin: '1vmin 0' }}>Select 4 cards to give to London</h2>
        <p style={{ fontSize: '2vmin', marginBottom: '2vmin' }}>Status: {state.givenToCity[myRole === 'Jekyll' ? 'Hyde' : 'Jekyll']?.length === 4 ? "Ready" : "Selecting"}</p>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(6, 1fr)', 
          gridTemplateRows: 'repeat(2, 1fr)',
          gap: '2vmin', 
          width: '100%',
          flex: 1,
          minHeight: 0
        }}>
          {state.hands[myRole].map((card, idx) => {
            const isSelected = selectedForCity.includes(idx);
            return (
              <div key={idx} style={{ width: '100%', height: '100%' }}>
                {renderCard(card, false, isSelected, () => {
                  if (isSelected) setSelectedForCity(prev => prev.filter(i => i !== idx));
                  else if (selectedForCity.length < 4) setSelectedForCity(prev => [...prev, idx]);
                })}
              </div>
            );
          })}
        </div>
        <button onClick={confirmGiveCards} disabled={selectedForCity.length !== 4} style={{ padding: '2vmin 4vmin', fontSize: '2.5vmin', cursor: 'pointer', borderRadius: '1vmin', marginTop: '3vmin' }}>Confirm</button>
      </div>
    );
  }

  // Phase 2: 본 게임 (완벽 비율 스케일링 적용)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', boxSizing: 'border-box', overflow: 'hidden', padding: '1.5vmin', gap: '1.5vmin' }}>
      
      {/* 헤더 바 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '0.2vmin solid rgba(0,0,0,0.2)', paddingBottom: '1vmin', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: '3vmin' }}>You are {myRole}</h2>
        <div style={{ display: 'flex', gap: '1vmin' }}>
          <button onClick={() => initNewGame('Jekyll')} style={{ padding: '1vmin 1.5vmin', fontSize: '1.5vmin', background: '#333', color: '#fff', border: 'none', borderRadius: '0.5vmin', cursor: 'pointer' }}>New Round (Jekyll Lead)</button>
          <button onClick={() => initNewGame('Hyde')} style={{ padding: '1vmin 1.5vmin', fontSize: '1.5vmin', background: '#555', color: '#fff', border: 'none', borderRadius: '0.5vmin', cursor: 'pointer' }}>New Round (Hyde Lead)</button>
        </div>
        <h2 style={{ margin: 0, fontWeight: 'normal', fontSize: '3vmin' }}>
          {state.turn === myRole ? "Your turn" : `Waiting for ${state.turn}`}
        </h2>
      </div>

      {/* 메인 레이아웃 (좌측 65% / 우측 35%) */}
      <div style={{ display: 'flex', gap: '1.5vmin', flex: 1, minHeight: 0 }}>
        
        {/* ===== MAIN COLUMN (좌측 65%) ===== */}
        <div style={{ width: '65%', display: 'flex', flexDirection: 'column', gap: '1.5vmin', height: '100%' }}>
          
          {/* 1. 상단: Current Trick & Rank (비율 축소 flex: 1) */}
          <div style={{ display: 'flex', gap: '1.5vmin', flex: 1, minHeight: 0 }}>
            
            <div style={{ flex: 2.5, backgroundColor: 'rgba(0,0,0,0.1)', padding: '1.5vmin', borderRadius: '1vmin', display: 'flex', flexDirection: 'column' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                 <h3 style={{ margin: 0, fontSize: '2vmin' }}>Current Trick</h3>
                 {state.turn === 'London' && state.currentTrick.length < 3 && (
                   <button onClick={playLondonCard} style={{ padding: '0.8vmin 1.5vmin', fontSize: '1.5vmin', backgroundColor: '#e67e22', color: '#fff', border: 'none', borderRadius: '0.5vmin', cursor: 'pointer' }}>Reveal London</button>
                 )}
               </div>
               
               <div style={{ display: 'flex', gap: '2vmin', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0, marginTop: '1vmin' }}>
                 {state.currentTrick.map((t, idx) => (
                   <div key={idx} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                     <div style={{ fontSize: '1.5vmin', marginBottom: '0.5vmin', flexShrink: 0 }}>{t.playedBy}</div>
                     <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', justifyContent: 'center' }}>
                        {renderCard(t.card)}
                     </div>
                   </div>
                 ))}
               </div>
               
               {state.currentTrick.length === 3 && (
                  <div style={{ textAlign: 'center', marginTop: '1vmin', flexShrink: 0 }}>
                    <button onClick={() => resolveTrick('Jekyll')} style={{ fontSize: '1.5vmin', padding: '0.6vmin 1.2vmin', cursor: 'pointer' }}>Jekyll Won</button>
                    <button onClick={() => resolveTrick('London')} style={{ fontSize: '1.5vmin', padding: '0.6vmin 1.2vmin', cursor: 'pointer', margin: '0 1vmin' }}>London Won</button>
                    <button onClick={() => resolveTrick('Hyde')} style={{ fontSize: '1.5vmin', padding: '0.6vmin 1.2vmin', cursor: 'pointer' }}>Hyde Won</button>
                  </div>
               )}
            </div>

            <div style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', padding: '1.5vmin', borderRadius: '1vmin', display: 'flex' }}>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5vmin' }}>
                  <h4 style={{ margin: 0, fontSize: '1.8vmin' }}>Rank</h4>
                  {[0, 1, 2].map((slotIndex) => (
                    <div key={slotIndex} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'rank', { index: slotIndex })}
                         style={{ width: '5vmin', height: '5vmin', border: '0.3vmin dashed #666', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {state.rankSlots[slotIndex] && (
                        <div draggable onDragStart={e => handleDragStart(e, 'suit', { fromSlot: slotIndex, suit: state.rankSlots[slotIndex] })}
                             style={{ width: '100%', height: '100%', borderRadius: '50%', backgroundColor: getRankCircleColor(state.rankSlots[slotIndex]), cursor: 'grab' }} />
                      )}
                    </div>
                  ))}
               </div>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5vmin', borderLeft: '0.2vmin solid #ccc' }}>
                  <h4 style={{ margin: 0, fontSize: '1.8vmin' }}>Unassigned</h4>
                  <div onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'rank', { index: 'unassigned' })} style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5vmin' }}>
                    {state.unassignedSuits.map(suit => (
                      <div key={suit} draggable onDragStart={e => handleDragStart(e, 'suit', { fromSlot: 'unassigned', suit })}
                           style={{ width: '5vmin', height: '5vmin', borderRadius: '50%', backgroundColor: getRankCircleColor(suit), cursor: 'grab', flexShrink: 0 }} />
                    ))}
                  </div>
               </div>
            </div>
          </div>

          {/* 2. 중단: Played Tricks (비율 대폭 확대 flex: 3) */}
          <div style={{ display: 'flex', gap: '1.5vmin', flex: 3, minHeight: 0 }}>
            {['Jekyll', 'London', 'Hyde'].map(owner => (
              <div key={owner} 
                   onDragOver={e => e.preventDefault()} 
                   onDrop={e => handleDrop(e, 'player_tricks', { target: owner })}
                   style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.05)', padding: '1.5vmin', borderRadius: '1vmin', display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ margin: '0 0 1.5vmin 0', textAlign: 'center', fontSize: '2vmin', flexShrink: 0 }}>{owner} Tricks</h4>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1vmin', alignContent: 'start', overflowY: 'auto', flex: 1 }}>
                  {state.playedTricks[owner].map((trickArr, idx) => {
                    const isLastLondonTrick = owner === 'London' && idx === state.playedTricks.London.length - 1;
                    return (
                      <div key={idx} 
                           draggable={isLastLondonTrick}
                           onDragStart={e => isLastLondonTrick && handleDragStart(e, 'london_trick', {})}
                           style={{ display: 'flex', gap: '0.3vmin', padding: '0.5vmin', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: '0.8vmin', cursor: isLastLondonTrick ? 'grab' : 'default', height: '8vmin' }}>
                        {trickArr.map((t, i) => 
                           // 딴 트릭 카드는 박스 안에 맞춰서 렌더링
                           <div key={i} style={{ width: '5vmin', height: '100%' }}>{renderCard(t.card)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 3. 하단: My Hand (비율 대폭 축소 flex: 0.8) */}
          <div style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '1vmin', borderRadius: '1vmin', flex: 0.8, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <h4 style={{ margin: '0 0 0.5vmin 0', fontSize: '1.8vmin', flexShrink: 0 }}>My Hand</h4>
            <div style={{ display: 'flex', gap: '1vmin', flex: 1, minHeight: 0, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
               {state.hands[myRole].map((card, idx) => 
                  <div key={idx} style={{ height: '100%' }}>
                     {renderCard(card, state.turn !== myRole && !exchangeMode, false, () => playOrExchangeCard(idx))}
                  </div>
               )}
            </div>
          </div>
        </div>

        {/* ===== SIDE COLUMN (우측 35%) ===== */}
        <div style={{ width: '35%', display: 'flex', flexDirection: 'column', gap: '1.5vmin', borderLeft: '0.2vmin solid rgba(0,0,0,0.1)', paddingLeft: '1.5vmin', height: '100%' }}>
          
          {/* 1영역: 트랙 (flex: 1) */}
          <div style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.4)', padding: '1.5vmin', borderRadius: '1vmin', position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <button onClick={resetTrackOnly} style={{ position: 'absolute', top: '1vmin', right: '1vmin', padding: '0.6vmin 1.2vmin', fontSize: '1.2vmin', cursor: 'pointer' }}>Reset Track</button>
            <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', marginTop: '2vmin' }}>
               <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '0.4vmin', backgroundColor: '#8b7355', zIndex: 1 }} />
               {[0,1,2,3,4,5,6,7,8,9,10].map(step => {
                  let text = '';
                  if (step === 2) text = 'I'; else if (step === 3) text = 'II'; else if (step === 4) text = 'III'; else if (step === 5) text = 'IV';
                  return (
                    <div key={step} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'track', { index: step })}
                         style={{ width: '3.5vmin', height: '3.5vmin', backgroundColor: '#eaddcf', border: '0.3vmin solid #8b7355', borderRadius: '50%', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.5vmin' }}>
                      {text}
                      {state.syPosition === step && <div draggable onDragStart={e=>handleDragStart(e, 'pawn', {pawn: 'sy'})} style={{position:'absolute', top:'-3.5vmin', background:'#1B375E', color:'#fff', padding:'0.3vmin 0.6vmin', borderRadius:'0.5vmin', fontSize:'1.2vmin', cursor:'grab'}}>SY</div>}
                      {state.jhPosition === step && <div draggable onDragStart={e=>handleDragStart(e, 'pawn', {pawn: 'jh'})} style={{position:'absolute', bottom:'-3.5vmin', background:'#333636', color:'#fff', padding:'0.3vmin 0.6vmin', borderRadius:'0.5vmin', fontSize:'1.2vmin', cursor:'grab'}}>JH</div>}
                    </div>
                  );
               })}
            </div>
          </div>

          {/* 2영역: 카드 그리드 Tracker (영역 완벽하게 꽉 차게 flex: 3) */}
          <div style={{ flex: 3, backgroundColor: 'rgba(0,0,0,0.1)', padding: '1.5vmin', borderRadius: '1vmin', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
             <h4 style={{ margin: '0 0 1.5vmin 0', fontSize: '2vmin', flexShrink: 0 }}>Card Tracker</h4>
             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(4, 1fr)', gap: '0.8vmin', flex: 1, minHeight: 0 }}>
               {['Fear', 'Ruse', 'Manipulation', 'Potion'].map((color) => {
                 const isPotion = color === 'Potion';
                 const startVal = isPotion ? 3 : 1;
                 const endVal = isPotion ? 6 : 8;
                 
                 return Array.from({length: endVal - startVal + 1}, (_, i) => i + startVal).map(val => {
                   const valueStr = isPotion ? `${val}+` : val;
                   const allPlayed = [...state.playedTricks.Jekyll, ...state.playedTricks.Hyde, ...state.playedTricks.London].flat();
                   
                   const isUsed = state.hands[myRole].some(c => c.color === color && c.value == valueStr) ||
                                  state.currentTrick.some(t => t.card.color === color && t.card.value == valueStr) ||
                                  allPlayed.some(t => t.card.color === color && t.card.value == valueStr);
                   
                   return (
                     <div key={color + val} style={{ gridColumn: val, display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: 0, minHeight: 0 }}>
                        {renderCard({ color, value: valueStr }, isUsed)}
                     </div>
                   );
                 });
               })}
             </div>
          </div>

          {/* 3영역: 런던 덱 교환 (flex: 0.6) */}
          <div style={{ flex: 0.6, backgroundColor: 'rgba(255,255,255,0.3)', padding: '1vmin', borderRadius: '1vmin', display: 'flex', alignItems: 'center', gap: '1vmin', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
              <h4 style={{ margin: '0 0 0.5vmin 0', fontSize: '1.5vmin' }}>London Given</h4>
              <div style={{ display: 'flex', gap: '0.5vmin', flex: 1, minHeight: 0 }}>
                {state.givenToCity[myRole].map((c, i) => 
                  <div key={i} style={{ height: '100%' }}>{renderCard(c)}</div>
                )}
              </div>
            </div>

            <div style={{ textAlign: 'center', padding: '1vmin', backgroundColor: exchangeMode ? '#ffeaa7' : 'transparent', border: '0.2vmin dashed #333', flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: '0.5vmin' }}>
              <h4 style={{ margin: '0 0 0.5vmin 0', fontSize: '1.5vmin' }}>London Deck ({state.cityDeck.length})</h4>
              {exchangeMode ? (
                 <p style={{ margin: 0, fontSize: '1.2vmin', color: '#d35400' }}>Select to exchange or <span onClick={() => setExchangeMode(false)} style={{ textDecoration: 'underline', cursor: 'pointer' }}>Cancel</span></p>
              ) : (
                 <button onClick={() => setExchangeMode(true)} disabled={state.cityDeck.length === 0} style={{ padding: '0.5vmin 1vmin', fontSize: '1.2vmin', cursor: 'pointer', borderRadius: '0.5vmin' }}>Exchange Card</button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}