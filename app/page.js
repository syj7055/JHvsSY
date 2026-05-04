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
  
  // 클라이언트 로컬 상태
  const [selectedForCity, setSelectedForCity] = useState([]); // 시작 시 런던에게 줄 4장 선택
  const [exchangeMode, setExchangeMode] = useState(false); // 카드 교환 모드

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
    // 남은 4장은 reserve (게임에서 쓰이지 않음)

    const initialGameState = {
      leader: leader,
      turn: leader,
      phase: 'give_cards', // 'give_cards' -> 'playing'
      currentTrick: [],
      playedTricks: { Jekyll: [], Hyde: [], London: [] },
      hands: { Jekyll: jekyllHand, Hyde: hydeHand },
      cityDeck: [],
      givenToCity: { Jekyll: [], Hyde: [] },
      rankSlots: [null, null, null], // Top, Mid, Bottom
      unassignedSuits: ['Fear', 'Ruse', 'Manipulation'],
      jhPosition: 2, // 'I' 위치 (인덱스 2)
      syPosition: 0,
    };

    if (game?.id) {
      await supabase.from('games').update({ game_state: initialGameState }).eq('id', game.id);
    } else {
      const { data: newData } = await supabase.from('games').insert([{ status: 'playing', game_state: initialGameState }]).select();
      if (newData) setGame(newData[0]);
    }
  };

  const resetTrackOnly = async () => {
    if (!game) return;
    await supabase.from('games').update({ 
      game_state: { ...game.game_state, jhPosition: 2, syPosition: 0 } 
    }).eq('id', game.id);
  };

  // 12장 중 4장 선택 후 런던에게 주기 확인
  const confirmGiveCards = async () => {
    if (selectedForCity.length !== 4) return;
    
    let state = { ...game.game_state };
    const myHand = [...state.hands[myRole]];
    const cardsToGive = selectedForCity.map(idx => myHand[idx]);
    
    // 내 손패에서 제거
    state.hands[myRole] = myHand.filter((_, idx) => !selectedForCity.includes(idx));
    state.givenToCity[myRole] = cardsToGive;

    // 만약 상대방도 이미 줬다면, 합쳐서 셔플 후 cityDeck 만들고 phase 변경
    const otherRole = myRole === 'Jekyll' ? 'Hyde' : 'Jekyll';
    if (state.givenToCity[otherRole].length === 4) {
      let combined = [...state.givenToCity[myRole], ...state.givenToCity[otherRole]];
      // 간단 셔플
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

    // 교환 모드일 때
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

    // 일반 플레이 모드일 때
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

    state.cityDeck = state.cityDeck;
    state.currentTrick = newTrick;
    state.turn = nextTurn;

    await supabase.from('games').update({ game_state: state }).eq('id', game.id);
  };

  const resolveTrick = async (winner) => {
    const state = { ...game.game_state };
    state.playedTricks[winner].push(state.currentTrick);
    state.currentTrick = [];
    state.turn = winner; // 승자가 선 플레이어
    await supabase.from('games').update({ game_state: state }).eq('id', game.id);
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e, type, payload) => {
    e.dataTransfer.setData('type', type);
    e.dataTransfer.setData('payload', JSON.stringify(payload));
  };

  const handleDrop = async (e, targetType, targetPayload) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('type');
    const payload = JSON.parse(e.dataTransfer.getData('payload') || '{}');
    const state = { ...game.game_state };

    // 1. 말 이동
    if (type === 'pawn' && targetType === 'track') {
      state[`${payload.pawn}Position`] = targetPayload.index;
      await supabase.from('games').update({ game_state: state }).eq('id', game.id);
    }
    
    // 2. 런던 트릭 재배치
    if (type === 'london_trick' && targetType === 'player_tricks' && (targetPayload.target === 'Jekyll' || targetPayload.target === 'Hyde')) {
      const trickToMove = state.playedTricks.London.pop(); // 런던의 마지막 트릭 제거
      if (trickToMove) {
        state.playedTricks[targetPayload.target].push(trickToMove);
        await supabase.from('games').update({ game_state: state }).eq('id', game.id);
      }
    }

    // 3. 수트 랭크 배치
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

  // 카드 디자인 헬퍼
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
      width: '60px', height: '90px',
      borderRadius: '6px',
      border: isSelected ? '4px solid #27ae60' : '2px solid rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '2rem', fontWeight: 'bold',
      cursor: isDisabled ? 'not-allowed' : 'pointer',
      opacity: isDisabled ? 0.3 : 1,
      boxShadow: '1px 2px 5px rgba(0,0,0,0.3)',
      userSelect: 'none'
    };
  };

  const renderCard = (card, isDisabled = false, isSelected = false, onClick = null) => {
    if (!card) return null;
    const isPolice = (card.value == 1 || card.value == 2 || card.value == 3) && card.color !== 'Potion';
    return (
      <div style={getCardStyle(card.color, isDisabled, isSelected)} onClick={onClick}>
        {isPolice && <img src="/police.png" style={{ position: 'absolute', top: 4, height: '18px' }} alt="Police" />}
        {card.value == 8 && <img src="/Run.png" style={{ position: 'absolute', top: 4, height: '18px' }} alt="Run" />}
        {card.value}
      </div>
    );
  };

  if (!game) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading</div>;
  const state = game.game_state;

  // 게임 로비 (역할 선택)
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

  // Phase 1: 런던에게 4장 주기 모드
  if (state.phase === 'give_cards') {
    return (
      <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
        <h2>Select 4 cards to give to London</h2>
        <p>Waiting for opponent: {state.givenToCity[myRole === 'Jekyll' ? 'Hyde' : 'Jekyll'].length === 4 ? "Ready" : "Selecting..."}</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', margin: '2rem 0' }}>
          {state.hands[myRole].map((card, idx) => {
            const isSelected = selectedForCity.includes(idx);
            return renderCard(card, false, isSelected, () => {
              if (isSelected) setSelectedForCity(prev => prev.filter(i => i !== idx));
              else if (selectedForCity.length < 4) setSelectedForCity(prev => [...prev, idx]);
            });
          })}
        </div>
        <button onClick={confirmGiveCards} disabled={selectedForCity.length !== 4} style={{ padding: '10px 20px', fontSize: '1.2rem', cursor: 'pointer' }}>Confirm 4 Cards</button>
      </div>
    );
  }

  // Phase 2: 실제 플레이 화면 (2단 레이아웃)
  return (
    <div style={{ display: 'flex', height: '100vh', boxSizing: 'border-box', overflow: 'hidden', padding: '1rem', gap: '1rem' }}>
      
      {/* ===== MAIN COLUMN (좌측 65%) ===== */}
      <div style={{ width: '65%', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>You are {myRole}</h2>
          <h2 style={{ margin: 0, fontWeight: 'normal' }}>
            {state.turn === myRole ? "Your turn" : `Waiting for ${state.turn}`}
          </h2>
        </div>

        {/* 상단: Current Trick & Suit Rank */}
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 2, backgroundColor: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '8px', minHeight: '160px' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between' }}>
               <h3 style={{ margin: 0 }}>Current Trick</h3>
               {state.turn === 'London' && state.currentTrick.length < 3 && (
                 <button onClick={playLondonCard} style={{ padding: '5px 10px', backgroundColor: '#e67e22', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Reveal London</button>
               )}
             </div>
             <div style={{ display: 'flex', gap: '1.5rem', justifyContent: 'center', marginTop: '1rem' }}>
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

          {/* 수트 랭크 영역 */}
          <div style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', padding: '1rem', borderRadius: '8px', display: 'flex' }}>
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <h4 style={{ margin: 0 }}>Rank</h4>
                {[0, 1, 2].map((slotIndex) => (
                  <div key={slotIndex} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'rank', { index: slotIndex })}
                       style={{ width: '40px', height: '40px', border: '2px dashed #666', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {state.rankSlots[slotIndex] && (
                      <div draggable onDragStart={e => handleDragStart(e, 'suit', { fromSlot: slotIndex, suit: state.rankSlots[slotIndex] })}
                           style={{ width: '100%', height: '100%', borderRadius: '50%', backgroundColor: getCardStyle(state.rankSlots[slotIndex]).backgroundColor }} />
                    )}
                  </div>
                ))}
             </div>
             <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', borderLeft: '1px solid #ccc' }}>
                <h4 style={{ margin: 0 }}>Unassigned</h4>
                <div onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'rank', { index: 'unassigned' })} style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                  {state.unassignedSuits.map(suit => (
                    <div key={suit} draggable onDragStart={e => handleDragStart(e, 'suit', { fromSlot: 'unassigned', suit })}
                         style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: getCardStyle(suit).backgroundColor, cursor: 'grab' }} />
                  ))}
                </div>
             </div>
          </div>
        </div>

        {/* 중단: 획득한 트릭들 */}
        <div style={{ display: 'flex', gap: '1rem', height: '160px' }}>
          {['Jekyll', 'London', 'Hyde'].map(owner => (
            <div key={owner} 
                 onDragOver={e => e.preventDefault()} 
                 onDrop={e => handleDrop(e, 'player_tricks', { target: owner })}
                 style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.05)', padding: '10px', borderRadius: '8px', overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 10px 0', textAlign: 'center' }}>{owner} Tricks</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {state.playedTricks[owner].map((trickArr, idx) => {
                  const isLastLondonTrick = owner === 'London' && idx === state.playedTricks.London.length - 1;
                  return (
                    <div key={idx} 
                         draggable={isLastLondonTrick}
                         onDragStart={e => isLastLondonTrick && handleDragStart(e, 'london_trick', {})}
                         style={{ display: 'flex', gap: '2px', padding: '2px', backgroundColor: 'rgba(255,255,255,0.5)', cursor: isLastLondonTrick ? 'grab' : 'default' }}>
                      {trickArr.map((t, i) => <div key={i} style={{...getCardStyle(t.card.color), width: '20px', height: '30px', fontSize: '0.8rem'}}>{t.card.value}</div>)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 하단: 내 손패 */}
        <div style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '1rem', borderRadius: '8px', flex: 1 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>My Hand</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
             {state.hands[myRole].map((card, idx) => renderCard(card, state.turn !== myRole && !exchangeMode, false, () => playOrExchangeCard(idx)))}
          </div>
        </div>
      </div>

      {/* ===== SIDE COLUMN (우측 35%) ===== */}
      <div style={{ width: '35%', display: 'flex', flexDirection: 'column', gap: '1rem', borderLeft: '2px solid #333', paddingLeft: '1rem', overflowY: 'auto' }}>
        
        {/* 1영역: 트랙 */}
        <div style={{ backgroundColor: 'rgba(255,255,255,0.4)', padding: '1rem', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
            <button onClick={resetTrackOnly} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>Reset Track</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
             <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '3px', backgroundColor: '#8b7355', zIndex: 1 }} />
             {[0,1,2,3,4,5,6,7,8,9,10].map(step => {
                let text = '';
                if (step === 2) text = 'I'; else if (step === 3) text = 'II'; else if (step === 4) text = 'III'; else if (step === 5) text = 'IV';
                return (
                  <div key={step} onDragOver={e => e.preventDefault()} onDrop={e => handleDrop(e, 'track', { index: step })}
                       style={{ width: '25px', height: '25px', backgroundColor: '#eaddcf', border: '2px solid #8b7355', borderRadius: '50%', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'serif', fontWeight: 'bold' }}>
                    {text}
                    {state.syPosition === step && <div draggable onDragStart={e=>handleDragStart(e, 'pawn', {pawn: 'sy'})} style={{position:'absolute', top:'-25px', background:'#c0392b', color:'#fff', padding:'2px 5px', fontSize:'0.7rem', cursor:'grab'}}>SY</div>}
                    {state.jhPosition === step && <div draggable onDragStart={e=>handleDragStart(e, 'pawn', {pawn: 'jh'})} style={{position:'absolute', bottom:'-25px', background:'#2c3e50', color:'#fff', padding:'2px 5px', fontSize:'0.7rem', cursor:'grab'}}>JH</div>}
                  </div>
                );
             })}
          </div>
        </div>

        {/* 2영역: 카드 그리드 Tracker */}
        <div style={{ backgroundColor: 'rgba(0,0,0,0.1)', padding: '1rem', borderRadius: '8px' }}>
           <h4 style={{ margin: '0 0 10px 0' }}>Card Tracker</h4>
           {['Fear', 'Ruse', 'Manipulation', 'Potion'].map(color => {
             const isPotion = color === 'Potion';
             const startVal = isPotion ? 3 : 1;
             const endVal = isPotion ? 6 : 8;
             return (
               <div key={color} style={{ display: 'flex', gap: '5px', marginBottom: '5px', paddingLeft: isPotion ? '60px' : '0' }}>
                 {Array.from({length: endVal - startVal + 1}, (_, i) => i + startVal).map(val => {
                   const valueStr = isPotion ? `${val}+` : val;
                   // 비활성화 체크: 내 손, 플레이된 트릭, 내가 제출한 카드, 중앙 트릭
                   const allPlayed = [...state.playedTricks.Jekyll, ...state.playedTricks.Hyde, ...state.playedTricks.London].flat();
                   const isUsed = state.hands[myRole].some(c => c.color === color && c.value == valueStr) ||
                                  state.givenToCity[myRole].some(c => c.color === color && c.value == valueStr) ||
                                  state.currentTrick.some(t => t.card.color === color && t.card.value == valueStr) ||
                                  allPlayed.some(t => t.card.color === color && t.card.value == valueStr);
                   return (
                     <div key={val} style={{ ...getCardStyle(color, isUsed), width: '25px', height: '35px', fontSize: '1rem' }}>
                       {valueStr}
                     </div>
                   );
                 })}
               </div>
             );
           })}
        </div>

        {/* 3영역 & 런던 덱 교환 */}
        <div style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', padding: '1rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <h4 style={{ margin: '0 0 10px 0' }}>Cards Given to London</h4>
            <div style={{ display: 'flex', gap: '5px' }}>
              {state.givenToCity[myRole].map((c, i) => <div key={i} style={{...getCardStyle(c.color), width:'35px', height:'50px', fontSize:'1.2rem'}}>{c.value}</div>)}
            </div>
          </div>

          <div style={{ marginTop: 'auto', textAlign: 'center', padding: '1rem', backgroundColor: exchangeMode ? '#ffeaa7' : 'transparent', border: '1px dashed #333' }}>
            <h4 style={{ margin: '0 0 5px 0' }}>London Deck ({state.cityDeck.length} left)</h4>
            {exchangeMode ? (
               <p style={{ margin: 0, fontSize: '0.9rem', color: '#d35400' }}>Select a card from your hand to exchange, or <span onClick={() => setExchangeMode(false)} style={{ textDecoration: 'underline', cursor: 'pointer' }}>Cancel</span></p>
            ) : (
               <button onClick={() => setExchangeMode(true)} disabled={state.cityDeck.length === 0} style={{ padding: '5px 10px' }}>Exchange Card (Manipulation)</button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}