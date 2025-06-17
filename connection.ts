export interface RoomInfo {
  roomId: string;
  playerCount: number;
  players: string[];
}

export interface Player {
  id: string;
  name: string;
  wins: boolean;
}

// 添加 WebSocket 连接函数
export function connectToRoom(
  SERVER_URL: string,
  roomId: string, 
  playerId: string, // 添加玩家ID参数
  onMessage: (data: any) => void
): WebSocket {
  // 构建WebSocket URL
  const wsProtocol = SERVER_URL.startsWith('https') ? 'wss' : 'ws';
  const wsHost = SERVER_URL.split('://')[1];
  
  // 添加玩家ID查询参数
  const wsUrl = `${wsProtocol}://${wsHost}?roomId=${roomId}&playerId=${playerId}`;
  
  console.log(`连接WebSocket: ${wsUrl}`);
  
  const ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket连接成功');
    ws.send(JSON.stringify({ 
      type: 'REQUEST_FULL_STATE',
      roomId,
      playerId 
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data); // 直接传递给回调函数
    } catch (e) {
      console.error('WebSocket消息解析错误:', e);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket错误:', error);
  };

  ws.onclose = (event) => {
    console.log('WebSocket连接关闭', event.code, event.reason);
  };

  return ws;
}

/** 注册／创建房间 */
export async function joinGame(
  SERVER_URL: string,
  playerId: string,
  name: string,
  roomId: string | null
): Promise<{ playerId: string; roomId: string }> {
  const paramRoomId = roomId ?? 'null';
  const url = `${SERVER_URL}/join/${paramRoomId}`;
  
  console.log(`加入游戏: ${url}`, { playerId, name });
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, name }),
    });
    
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`加入失败 (${res.status}): ${txt}`);
    }
    
    return res.json();
  } catch (error) {
    console.error('加入游戏错误:', error);
    throw new Error('无法加入游戏，请检查网络连接');
  }
}

/** 获取房间列表 */
export async function getRoomList(
  SERVER_URL: string
): Promise<RoomInfo[]> {
  try {
    const res = await fetch(`${SERVER_URL}/rooms`);
    if (!res.ok) {
      throw new Error(`获取房间列表失败 (${res.status})`);
    }
    return res.json();
  } catch (error) {
    console.error('获取房间列表错误:', error);
    throw new Error('无法加载房间列表，请检查服务器连接');
  }
}

/** 拉取状态，包括手牌 */
export async function getGameState(
  SERVER_URL: string,
  playerId: string,
  roomId: string
): Promise<{
  topCard: any; 
  currentPlayerId: string; 
  currentPlayerName: string; 
  hand: any[]; 
  players: any[];
  canPlay: boolean;
  isOver: boolean;
}> {
  const url = `${SERVER_URL}/state/${roomId}/${playerId}`;
  console.log(`获取游戏状态: ${url}`);
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`获取状态失败 (${res.status}): ${txt}`);
    }
    return res.json();
  } catch (error) {
    console.error('获取游戏状态错误:', error);
    throw new Error('无法加载游戏状态，请重试');
  }
}

/** 提交动作 */
export async function sendAction(
  SERVER_URL: string,
  playerId: string,
  action: any,
  roomId: string
): Promise<void> {
  const url = `${SERVER_URL}/action/${roomId}`;
  console.log(`提交动作: ${url}`, { playerId, action });
  
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, action }),
    });
    
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `操作失败 (${res.status})`);
    }
  } catch (error) {
    console.error('提交动作错误:', error);
    throw new Error('操作失败，请检查网络连接');
  }
}

/**
 * "游戏客户端"
 */
export function createGameClient(
  SERVER_URL: string,
  playerId: string,
  roomId: string
) {
  return {
    playerId,
    roomId,
    async downloadState() {
      return await getGameState(SERVER_URL, playerId, roomId);
    },
    async uploadAction(act: any) {
      await sendAction(SERVER_URL, playerId, act, roomId);
    }
  };
}