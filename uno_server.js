const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  verifyClient: (info, done) => {
    done(true); // 允许所有连接
  }
});

app.use(cors());
app.use(express.json());

const games = {};

// UNO 牌的定义
const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'ban', 'reverse', 'draw_2'];
const WILD_CARDS = [{ value: 'change_color' }, { value: 'draw_4' }];

/**
 * 获取当前弃牌堆顶牌的“有效颜色”：
 * - 如果顶牌是野牌（color==='wild'）且有 chosenColor 字段，则返回 chosenColor
 * - 否则返回顶牌本身的 color
 */
function getTopEffectiveColor(game) {
  if (!game.discardPile || game.discardPile.length === 0) return null;
  const top = game.discardPile[game.discardPile.length - 1];
  if (top.color === 'wild' && top.chosenColor) {
    return top.chosenColor;
  }
  return top.color;
}

/** Fisher–Yates Shuffle */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 生成并洗乱一副牌 */
function generateDeck() {
  const deck = [];
  COLORS.forEach(color => {
    VALUES.forEach(value => {
      deck.push({ id: uuidv4(), color, value });
      if (value !== '0') deck.push({ id: uuidv4(), color, value });
    });
  });
  // Wild 卡
  for (let i = 0; i < 4; i++) {
    WILD_CARDS.forEach(w => deck.push({ id: uuidv4(), color: 'wild', value: w.value }));
  }
  return shuffle(deck);
}

/** 给房间里每位玩家发 7 张牌，翻出一张顶牌 */
function initGameForRoom(roomId) {
  const game = games[roomId];
  
  try {
    // 重置游戏结束标志
    game.isOver = false;
    // 重置所有玩家 wins 属性
    game.players.forEach(p => {
      p.wins = false;
    });

    game.deck = generateDeck();
    
    // 确保顶牌不是特殊牌
    let topCard;
    do {
      if (game.deck.length === 0) {
        throw new Error("牌堆为空，无法初始化游戏");
      }
      topCard = game.deck.pop();
    } while (topCard.value === 'draw_4' || topCard.value === 'change_color');
    
    game.discardPile = [topCard];
    game.currentPlayerIndex = 0;
    game.hands = {};
    
    // 给每位玩家发牌
    game.players.forEach(p => {
      game.hands[p.id] = [];
      for (let i = 0; i < 7; i++) {
        if (game.deck.length === 0) {
          throw new Error("牌堆为空，无法发牌");
        }
        game.hands[p.id].push(game.deck.pop());
      }
    });
    
    console.log(`房间 ${roomId} 游戏初始化完成`);
  } catch (error) {
    console.error(`房间 ${roomId} 游戏初始化失败:`, error.message);
    // 重置游戏状态
    game.deck = [];
    game.discardPile = [];
    game.hands = {};
  }
}

/** 取当前出牌者的 playerId */
function getCurrentPlayerId(roomId) {
  const game = games[roomId];
  if (!game || !game.players || game.players.length === 0) return null;
  return game.players[game.currentPlayerIndex].id;
}

/**
 * 通用广播函数
 * @param {string} roomId 房间 ID
 */
function broadcastUpdate() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ needUpdate: true }));
    }
  });
}

// 获取可用房间列表
app.get('/rooms', (req, res) => {
  const availableRooms = Object.entries(games)
    .map(([id, game]) => ({
      roomId: id,
      playerCount: game.players.length,
      players: game.players.map(p => p.name)
    }));
  
  res.json(availableRooms);
});

// --- REST: Join/Create Room ---
app.post('/join/:roomId', (req, res) => {
  let roomId = req.params.roomId;
  if (roomId === 'null') {
    roomId = uuidv4();
    console.log(`创建新房间: ${roomId}`);
  }

  if (!games[roomId]) {
    games[roomId] = {
      players: [],
      deck: [],
      discardPile: [],
      currentPlayerIndex: 0,
      hands: {}
    };
  }
  
  const game = games[roomId];
  const clientId = req.body.playerId;
  const name = req.body.name;

  // 避免重复加入
  const existingPlayer = game.players.find(p => p.id === clientId);
  if (!existingPlayer) {
    game.players.push({ id: clientId, name });
    console.log(`玩家 ${name} 加入房间 ${roomId}，当前玩家数: ${game.players.length}`);
  } else {
    // 触发房间更新广播 - 发送完整状态
    broadcastUpdate();
    res.json({ playerId: clientId, roomId });
    console.log(`玩家 ${name} 已存在，跳过重复加入`);
    return;
  }

  // 触发房间更新广播 - 发送完整状态
  broadcastUpdate();

  // 检查是否可以开始游戏
  if (game.players.length >= 2) {
    try {
      initGameForRoom(roomId);
      console.log(`房间 ${roomId} 游戏开始！`);
      broadcastUpdate();
    } catch (error) {
      console.error(`房间 ${roomId} 启动游戏失败:`, error.message);
      res.status(500).json({ error: '游戏初始化失败' });
      return;
    }
  }

  res.json({ playerId: clientId, roomId });
});

// 添加初始状态端点
app.get('/state/:roomId/init', (req, res) => {
  const roomId = req.params.roomId;
  const playerId = req.playerId;
  const game = games[roomId];
  
  if (!game) {
    return res.status(404).json({ error: '房间不存在' });
  }
  
  res.json({
    players: game.players,
    topCard: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null,
    currentPlayerId: getCurrentPlayerId(roomId),
    currentPlayerName: game.players.find(p => p.id === getCurrentPlayerId(roomId))?.name || '',
    canPlay: getCurrentPlayerId(roomId) === playerId,
    isOver: game.isOver,
    hand: game.hands[playerId] || [],
  });
});

// --- REST: Get State (含手牌) ---
app.get('/state/:roomId/:playerId', (req, res) => {
  const { roomId, playerId } = req.params;
  const game = games[roomId];
  
  if (!game) {
    return res.status(404).json({ error: '房间不存在' });
  }
  
  try {
    const state = {
      topCard: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null,
      currentPlayerId: getCurrentPlayerId(roomId),
      currentPlayerName: '',
      hand: game.hands[playerId] || [],
      players: game.players,
      canPlay: false,
      isOver: game.isOver,
    };
    
    // 获取当前玩家名称
    if (state.currentPlayerId) {
      const player = game.players.find(p => p.id === state.currentPlayerId);
      if (player) {
        state.currentPlayerName = player.name;
      }
    }
    
    // 检查是否可以操作
    state.canPlay = state.currentPlayerId === playerId;
    
    res.json(state);
  } catch (error) {
    console.error(`获取房间 ${roomId} 状态失败: ${error.message}`);
    res.status(500).json({ error: '获取状态失败' });
  }
});

app.post('/action/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const { playerId, action } = req.body;
  const game = games[roomId];
  
  if (!game) {
    return res.status(404).json({ error: '房间不存在' });
  }

  // 非当前玩家不能操作
  const currentPlayerId = getCurrentPlayerId(roomId);
  if (currentPlayerId !== playerId) {
    return res.status(403).json({ 
      error: '不是你的回合',
      currentPlayerId,
      currentPlayerName: game.players.find(p => p.id === currentPlayerId)?.name || '未知玩家'
    });
  }

  try {
    if (action.type === 'PLAY_CARD') {
      // 1. 验证玩家是否有这张牌
      const hand = game.hands[playerId] || [];
      const cardIndex = hand.findIndex(card => card.id === action.cardId);
      
      if (cardIndex === -1) {
        return res.status(400).json({ error: '你没有这张牌' });
      }
      
      const card = hand[cardIndex];
      const topCard = game.discardPile[game.discardPile.length - 1];
      const topColor = getTopEffectiveColor(game);
      
      // 2. 对野牌（wild）或变色牌，加四牌，要求客户端传入 chosenColor
      if (card.color === 'wild') {
        // action.value 应与 card.value 对应，可选 'change_color' 或 'draw_4'
        if (card.value === 'change_color' || card.value === 'draw_4') {
          const chosenColor = action.chosenColor;
          // 检查客户端是否传来了 chosenColor，并且合法
          if (!chosenColor || !['red','blue','green','yellow'].includes(chosenColor)) {
            return res.status(400).json({ error: '出野牌时必须提供合法的 chosenColor: red/blue/green/yellow' });
          }
          // 允许出牌，无需再检查颜色或数值匹配
        }
      } else {
        // 3. 验证出牌是否合法：颜色或数值或功能相同
        const isValidPlay = (card.color === topColor) || (card.value === topCard.value);
        if (!isValidPlay) {
          return res.status(400).json({ error: '非法出牌' });
        }
      }
      
      // 4. 出牌：从手牌移除，加入弃牌堆
      hand.splice(cardIndex, 1);
      // 给弃牌堆保存一个对象副本，以防后续修改原 card 不便
      // 这里直接使用 card 对象并在后面可能添加 chosenColor 字段
      game.discardPile.push(card);

      // 5. 如果是野牌，需要将 color 记录在该 card 对象上，便于后续匹配
      if (card.color === 'wild') {
        // action.chosenColor 已在上面验证过
        card.color = action.chosenColor; 
      }

      // 6. 处理特殊卡牌效果
      if (card.value === 'draw_2') {
        // 下一位玩家摸2张牌
        const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
        const nextPlayerId = game.players[nextPlayerIndex].id;
        for (let i = 0; i < 2; i++) {
          if (game.deck.length > 0) {
            game.hands[nextPlayerId].push(game.deck.pop());
          }
        }
        game.currentPlayerIndex = nextPlayerIndex; // 直接跳过下一玩家
      } else if (card.value === 'draw_4') {
        // 下一位玩家摸4张牌
        const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
        const nextPlayerId = game.players[nextPlayerIndex].id;
        for (let i = 0; i < 4; i++) {
          if (game.deck.length > 0) {
            game.hands[nextPlayerId].push(game.deck.pop());
          }
        }
        game.currentPlayerIndex = nextPlayerIndex;
      } else if (card.value === 'ban') {
        // 跳过下一位玩家
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
      } else if (card.value === 'reverse') {
        // 反转出牌顺序
        game.players.reverse();
        game.currentPlayerIndex = game.players.length - 1 - game.currentPlayerIndex;
      }

      // 7. 检查玩家是否获胜
      if (hand.length === 0) {
        console.log(`玩家 ${playerId} 获胜!`);
        // 设置胜利标志
        const playerObj = game.players.find(p => p.id === playerId);
        if (playerObj) {
          playerObj.wins = true;
        }
        let all_won = true;
        game.players.map(player => all_won &= player.wins);
        if (all_won) {
          game.isOver = true;
        }
      }

      if (game.players[game.currentPlayerIndex].wins) {
        game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
      }
    }
    else if (action.type === 'DRAW_CARD') {
      // 原有摸牌逻辑保持不变
      if (game.deck.length > 0) {
        game.hands[playerId].push(game.deck.pop());
      } else {
        if (game.discardPile.length > 1) {
          const topCard = game.discardPile.pop();
          game.deck = shuffle([...game.discardPile]);
          game.discardPile = [topCard];
          game.hands[playerId].push(game.deck.pop());
        }
      }
    }

    game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

    // 广播状态更新
    broadcastUpdate();
    
    res.json({ success: true });
  } catch (error) {
    console.error(`处理动作失败: ${error.message}`);
    res.status(500).json({ error: '处理动作失败' });
  }
});

// WebSocket 连接时记录玩家ID
wss.on('connection', (ws, req) => {
  console.log('新的WebSocket连接');
  
  // 从URL中解析玩家ID和房间ID
  const queryParams = new URLSearchParams(req.url.split('?')[1]);
  const playerId = queryParams.get('playerId');
  const roomId = queryParams.get('roomId');
  
  if (playerId && roomId) {
    ws.playerId = playerId;
    ws.roomId = roomId;
    console.log(`玩家 ${playerId} 加入房间 ${roomId} 的WebSocket`);
  }

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'JOIN_WS' && data.roomId && data.playerId) {
        // 记录玩家ID和房间ID
        ws.playerId = data.playerId;
        ws.roomId = data.roomId;
        console.log(`玩家 ${data.playerId} 加入WebSocket房间: ${data.roomId}`);
        
        // 发送初始状态
        const game = games[data.roomId];
        if (game) {
          const playerState = {
            players: game.players,
            topCard: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : null,
            currentPlayerId: getCurrentPlayerId(data.roomId),
            currentPlayerName: game.players.find(p => p.id === getCurrentPlayerId(data.roomId))?.name || '',
            hand: game.hands[data.playerId] || [],
            canPlay: getCurrentPlayerId(data.roomId) === data.playerId
          };
          ws.send(JSON.stringify(playerState));
        }
      }
    } catch (e) {
      console.error('WebSocket消息解析错误:', e);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket连接错误:', error);
  });

  ws.on('close', () => {
    console.log('客户端断开WebSocket连接');
  });
});

server.listen(3000, '0.0.0.0', () => {
  console.log('UNO服务器正在运行:');
  console.log('本地访问: http://localhost:3000');
  console.log('网络访问: http://<你的IP地址>:3000');
  console.log('等待玩家连接...');
});