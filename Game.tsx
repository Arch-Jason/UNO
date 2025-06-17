import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import {createGameClient, connectToRoom, Player} from './connection';
import {cardImages} from './cardImages';

interface Card {
  id: string;
  color: string;
  value: string;
}

interface GameState {
  topCard: Card | null;
  currentPlayerId: string;
  currentPlayerName: string;
  hand: Card[];
  players: Player[];
  canPlay: boolean;
  isOver: boolean;
}

const COLORS = ['red', 'blue', 'green', 'yellow'];

export default function Game({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const serverAddr = route.params.serverAddr as string;

  const playerId = route.params.playerId as string;
  const playerName = route.params.playerNickName as string;
  const roomId = route.params.roomId as string;

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('连接中...');

  const [client, setClient] = useState<any>(null);

  const [wildCardToPlay, setWildCardToPlay] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const [won, setWon] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<(data: any) => Promise<void>>(null);

  // 保持回调引用最新
  useEffect(() => {
    onMessageRef.current = handleStateUpdate;
  });

  // wild card handler
  const onWildCardPress = (cardId: string) => {
    setWildCardToPlay(cardId);
    setModalVisible(true);
  };
  // 选完颜色后的处理
  const handleChooseColor = (color: string) => {
    if (wildCardToPlay) {
      // 调用出牌接口，带 chosenColor 字段
      doAction({
        type: 'PLAY_CARD',
        cardId: wildCardToPlay,
        chosenColor: color,
      });
    }
    // 关闭 modal 并重置
    setModalVisible(false);
    setWildCardToPlay(null);
  };
  const handleCancelChoose = () => {
    setModalVisible(false);
    setWildCardToPlay(null);
  };

  // 统一游戏状态管理
  const [gameState, setGameState] = useState<GameState>({
    topCard: null,
    currentPlayerId: '',
    currentPlayerName: '',
    hand: [],
    players: [],
    canPlay: false,
    isOver: false,
  });

  // 处理WebSocket消息
  const handleStateUpdate = async (data: any) => {
    console.log(data);
    await fetchState();
  };

  // 初始化游戏客户端和WebSocket连接
  useEffect(() => {
    const initClient = async () => {
      try {
        setConnectionStatus('正在连接服务器...');
        const gc = createGameClient(serverAddr, playerId, roomId);
        setClient(gc);

        // 获取初始房间状态
        try {
          const roomState = await gc.downloadState();
          setGameState(prev => ({
            ...prev,
            players: roomState.players
          }));
          console.log('初始房间状态:', roomState);
        } catch (e) {
          console.error('获取初始状态失败:', e);
        }

        // 连接WebSocket用于实时更新
        setConnectionStatus('正在建立实时连接...');

        // 修改这里：传递玩家ID
        wsRef.current = connectToRoom(
          serverAddr,
          roomId,
          playerId,
          (data) => onMessageRef.current ? onMessageRef.current(data) : null,
        );

        // 设置WebSocket事件监听
        if (wsRef.current) {
          wsRef.current.onopen = () => {
            setConnectionStatus('实时连接已建立');
            fetchState(); // 连接成功后立即获取状态
          };
          wsRef.current.onerror = (e: any) => {
            setConnectionStatus('连接错误');
            setError(`实时连接错误: ${e.message || '未知错误'}`);
          };
          wsRef.current.onclose = () => setConnectionStatus('连接已关闭');
        }
      } catch (e: any) {
        console.error('初始化客户端失败:', e);
        setError(e.message || '初始化失败');
        setLoading(false);
      }
    };

    initClient();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      setLoading(false); // 防止组件卸载后更新状态
    };
  }, []);

  // 获取游戏状态
  const fetchState = async () => {
    if (!client) return;
    setLoading(true);
    try {
      const state = await client.downloadState();

      setGameState(state);
      const playerObj = state.players.find((p: any) => p.id === playerId);
      setWon(playerObj ? playerObj.wins : false);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 显示错误状态
  if (error) {
    return (
      <View style={[styles.center, {padding: 20}]}>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.connectionStatus}>状态: {connectionStatus}</Text>
        <Text style={styles.roomLabel}>房间号: {roomId}</Text>

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>返回首页</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.retryButton} onPress={fetchState}>
          <Text style={styles.retryButtonText}>重试</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 显示加载状态
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#fff" />
        <Text style={styles.loadingText}>正在加载游戏…</Text>
        <Text style={styles.connectionStatus}>{connectionStatus}</Text>
        <Text style={styles.roomLabel}>房间号: {roomId}</Text>

        <TouchableOpacity style={styles.retryButton} onPress={fetchState}>
          <Text style={styles.retryButtonText}>刷新状态</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 游戏等待开始状态
  if (gameState.players.length < 2) {
    return (
      <View style={styles.center}>
        <Text style={styles.waitingTitle}>等待游戏开始</Text>
        <Text style={styles.roomLabel}>房间号: {roomId}</Text>
        <Text style={styles.connectionStatus}>状态: {connectionStatus}</Text>

        <View style={styles.playersContainer}>
          <Text style={styles.playersTitle}>
            已加入玩家 ({gameState.players.length}):
          </Text>
          {gameState.players.map((player, index) => (
            <Text key={player.id} style={styles.playerName}>
              {index + 1}. {player.name}{' '}
              {player.id === playerId ? '(你)' : ''}
            </Text>
          ))}
        </View>

        <Text style={styles.waitingText}>
          {gameState.players.length < 2
            ? '至少需要2名玩家才能开始游戏'
            : '等待房主开始游戏...'}
        </Text>

        <TouchableOpacity style={styles.refreshButton} onPress={fetchState}>
          <Text style={styles.refreshButtonText}>刷新状态</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 获取卡牌图片资源
  const getCardAsset = (color: string, value: string) => {
    const key = `${color.toLowerCase()}_${value.toLowerCase()}`;
    return cardImages[key] || cardImages['back'];
  };

  // 执行游戏动作
  const doAction = async (act: any) => {
    try {
      if (!gameState.canPlay) {
        Alert.alert('提示', '现在不是你的回合');
        return;
      }

      await client.uploadAction(act);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // 检查是否可以出牌
  const canPlayCard = (card: Card) => {
    if (!gameState.topCard) return true;

    if (won) {
      return false;
    }

    return (
      card.color === 'wild' ||
      card.color === gameState.topCard.color ||
      card.value === gameState.topCard.value
    );
  };

  return (
    <View style={styles.container}>
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelChoose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>请选择一个颜色</Text>
            {COLORS.map(color => (
              <TouchableOpacity
                key={color}
                style={[styles.colorButton, { borderColor: color }]}
                onPress={() => handleChooseColor(color)}
              >
                <Text style={styles.colorButtonText}>{color}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCancelChoose}
            >
              <Text style={styles.cancelButtonText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={won}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {}}
      >
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <Text style={styles.winModalTitle}>🎉 恭喜获胜! 🎉</Text>
            <Text style={styles.winModalText}>你出完牌了，你是第几个赢的？</Text>
            
            <View style={styles.winButtonContainer}>
              <TouchableOpacity 
                style={[styles.winButton, styles.winButtonClose]}
                onPress={() => setWon(false)}
              >
                <Text style={styles.winButtonText}>确定</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={{
        flexDirection: 'row'
      }}>
        <View style={{
          flex: 1,
          flexDirection: 'column',
          justifyContent: 'flex-start'
        }}>
          <Text style={styles.roomLabel}>房间号: {roomId}</Text>
          <Text style={styles.connectionStatus}>状态: {connectionStatus}</Text>
        </View>

        <View style={styles.playerInfo}>
          <Text style={styles.playerName}>玩家: {playerName}</Text>
          <Text style={styles.turnText}>
            {gameState.canPlay
              ? '✅ 你的回合'
              : `当前回合: ${gameState.currentPlayerName}`}
          </Text>
        </View>
      </View>
      
      <View style={{
        flex: 1.5,
        flexDirection: 'row',
        justifyContent: 'center'
      }}>
        <View style={{
          flex: 3,
          alignSelf: 'center',
          flexDirection: 'row',
          marginTop: 10,
          paddingHorizontal: 350
        }}>
          <View style={styles.deckArea}>
            <TouchableOpacity
              onPress={() => doAction({type: 'DRAW_CARD'})}
              disabled={!gameState.canPlay}>
              <Image
                source={require('./assets/cards/card_back.png')}
                style={styles.deckCard}
              />
              <Text style={styles.drawText}>摸牌</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.topCardArea}>
            {gameState.topCard ? (
              <Image
                source={getCardAsset(
                  gameState.topCard.color,
                  gameState.topCard.value,
                )}
                style={styles.topCard}
              />
            ) : (
              <Image
                source={require('./assets/cards/card_back.png')}
                style={styles.topCard}
              />
            )}
          </View>
        </View>

        <ScrollView style={styles.playersSection}>
          <Text style={styles.sectionTitle}>玩家列表</Text>
          {gameState.players.map(player => (
            <Text
              key={player.id}
              style={[
                styles.playerItem,
                player.id === gameState.currentPlayerId && styles.currentPlayer,
                player.id === playerId && styles.selfPlayer,
              ]}>
              {player.id === gameState.currentPlayerId && ' 👉'}
              {player.name} {player.id === playerId && '(你)'}
            </Text>
          ))}
        </ScrollView>
      </View>

      <View style={{
        flexDirection: 'row',
        flex: 1.2,
        alignSelf: 'center'
      }}>
        <ScrollView
          horizontal
          contentContainerStyle={styles.handContainer}
          style={{
            alignSelf: 'center',
            flex: 2
          }}
          showsHorizontalScrollIndicator={false}>
          {gameState.hand.map(card => {
            const playable = gameState.canPlay && canPlayCard(card);
            return (
              <TouchableOpacity
                key={card.id}
                onPress={() => {
                  if (playable) {
                    if (card.color === 'wild') {
                      onWildCardPress(card.id);
                    } else {
                      doAction({ type: 'PLAY_CARD', cardId: card.id });
                    }
                  }
                }}
                style={
                  playable ? styles.playableCard : styles.disabledCardContainer
                }>
                <Image
                  source={getCardAsset(card.color, card.value)}
                  style={[styles.handCard, !playable && styles.disabledCard]}
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        
        <TouchableOpacity style={styles.refreshButton} onPress={fetchState}>
          <Text style={styles.refreshButtonText}>刷新状态</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#006400',
    paddingTop: 40,
    paddingHorizontal: 10,
    flexDirection: 'column'
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#006400',
    padding: 20,
  },
  errorText: {
    color: '#FF6B6B',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  connectionStatus: {
    color: '#aaa',
    textAlign: 'center',
    fontSize: 14
  },
  backButton: {
    backgroundColor: '#4A90E2',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
    marginTop: 20,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  retryButton: {
    backgroundColor: '#4A90E2',
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
    marginTop: 10,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingText: {
    marginTop: 20,
    color: '#fff',
    fontSize: 18,
  },
  roomLabel: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 16
  },
  waitingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  waitingText: {
    fontSize: 18,
    color: '#fff',
    marginTop: 20,
    textAlign: 'center',
  },
  playersContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 10,
    padding: 20,
    marginVertical: 10,
    width: '80%',
  },
  playersTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  playerName: {
    fontSize: 16,
    color: '#fff'
  },
  refreshButton: {
    flex: 0.1,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 25,
    padding: 10,
    margin: 10,
    alignSelf: 'center',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  startButton: {
    marginTop: 20,
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 30,
  },
  disabledButton: {
    backgroundColor: '#9E9E9E',
  },
  startButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  handContainer: {
    flexDirection: 'row',
    alignSelf: 'center',
    padding: 10
  },
  handCard: {
    width: 60,
    height: 90,
    marginHorizontal: 5,
  },
  disabledCard: {
    opacity: 0.5,
  },
  disabledCardContainer: {
    opacity: 0.7,
  },
  playableCard: {
    marginBottom: 10,
  },
  deckArea: {
    marginHorizontal: 10
  },
  deckCard: {
    width: 80,
    height: 120,
  },
  drawText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 5,
    textAlign: 'center',
  },
  topCardArea: {
    marginHorizontal: 10
  },
  topCard: {
    width: 80,
    height: 120,
  },
  playerInfo: {
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  turnText: {
    color: '#ffcc00',
    fontSize: 16,
    fontWeight: 'bold',
  },
  playersSection: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 10,
    padding: 15,
    marginVertical: 10,
    flexDirection: 'column'
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  playerItem: {
    color: '#fff',
    fontSize: 16,
    paddingVertical: 5,
  },
  currentPlayer: {
    color: '#ffcc00',
    fontWeight: 'bold',
  },
  selfPlayer: {
    fontWeight: 'bold',
  },
    modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  colorButton: {
    width: '100%',
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 4,
    marginVertical: 4,
    alignItems: 'center',
  },
  colorButtonText: {
    fontSize: 14,
    textTransform: 'capitalize',
  },
  cancelButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelButtonText: {
    color: '#666',
  },
    centeredView: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  modalView: {
    margin: 20,
    backgroundColor: "white",
    borderRadius: 20,
    padding: 35,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '80%'
  },
  winModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: "center",
    color: '#4a6da7'
  },
  winModalText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: "center",
    color: '#333'
  },
  winButtonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%'
  },
  winButton: {
    borderRadius: 10,
    padding: 10,
    elevation: 2,
    minWidth: 100,
    justifyContent: 'center',
    alignItems: 'center'
  },
  winButtonClose: {
    backgroundColor: "#4a6da7",
  },
  winButtonText: {
    color: "white",
    fontWeight: "bold",
    textAlign: "center"
  }
});
