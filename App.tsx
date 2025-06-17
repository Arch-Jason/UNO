import React, { useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Button,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Game from './Game';
import { joinGame, getRoomList, RoomInfo } from './connection';
import { playerIdGlobal } from '.';

const Stack = createNativeStackNavigator();

let playerNameGlobal = "";

function RoomListElement({ serverAddr, navigation, roomInfo }: { serverAddr: string, navigation: any, roomInfo: RoomInfo }): React.JSX.Element {
  return (
    <View style={styles.roomElement}>
      <View style={styles.roomInfo}>
        <Text style={styles.roomIdText}>房间 {roomInfo.roomId.slice(0, 8)}</Text>
        <Text style={styles.playerCountText}>
          玩家: {roomInfo.playerCount}
        </Text>
      </View>
      <Button
        title="加入"
        onPress={async () => {
          const { playerId, roomId } = await joinGame(
                  serverAddr,
                  playerIdGlobal,
                  playerNameGlobal,
                  roomInfo.roomId
                );
          navigation.navigate("Game", {
            serverAddr,
            playerId: playerId,
            playerNickName: playerNameGlobal,
            roomId: roomId
          });
        }}
      />
    </View>
  );
}

function RoomList({ serverAddr, navigation, roomInfoList }: { serverAddr: string, navigation: any, roomInfoList: RoomInfo[] }): React.JSX.Element {
  if (roomInfoList.length === 0) {
    return (
      <View style={styles.noRoomsContainer}>
        <Text style={styles.noRoomsText}>暂无可用房间</Text>
        <Text style={styles.noRoomsHint}>请创建新房间或稍后再试</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.roomListContainer}>
      {roomInfoList.map((roomInfo) => (
        <RoomListElement serverAddr={serverAddr} key={roomInfo.roomId} navigation={navigation} roomInfo={roomInfo} />
      ))}
    </ScrollView>
  );
}

function HomeScreen({ navigation }: { navigation: any }): React.JSX.Element {
  const [playerName, setPlayerName] = useState("默认昵称");
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverAddr, setServerAddr] = useState<string>("");

  useEffect(() => {
    playerNameGlobal = playerName;
  }, [playerName]);

  useEffect(() => {
    const loadRooms = async () => {
      try {
        setLoading(true);
        const roomList = await getRoomList(serverAddr);
        setRooms(roomList);
        setError(null);
      } catch (e: any) {
        console.error('加载房间列表失败', e);
        setError('无法加载房间列表，请检查服务器连接');
      } finally {
        setLoading(false);
      }
    };

    loadRooms();
    const interval = setInterval(loadRooms, 5000);
    
    return () => clearInterval(interval);
  }, [serverAddr]);

  return (
    <View style={styles.homeContainer}>
      <Text style={styles.title}>UNO 多人游戏</Text>
      
      <View style={styles.contentContainer}>
        <View style={styles.leftPanel}>
          <TextInput
            style={styles.nameInput}
            placeholder="服务器地址"
            defaultValue={serverAddr}
            onChangeText={(value) => {
              setServerAddr(value)
            }}
          />

          <TextInput
            style={styles.nameInput}
            placeholder="输入昵称"
            defaultValue={playerName}
            onChangeText={setPlayerName}
          />

          <TouchableOpacity
            onPress={async () => {
              try {
                const { playerId, roomId } = await joinGame(
                  serverAddr,
                  playerIdGlobal,
                  playerName,
                  null
                );
                navigation.navigate('Game', {
                  serverAddr,
                  playerId,
                  playerNickName: playerName,
                  roomId,
                });
              } catch (e: any) {
                console.error('创建房间失败', e);
                setError('创建房间失败: ' + e.message);
              }
            }}
            style={styles.createButton}
          >
            <Text style={styles.createButtonText}>创建房间</Text>
          </TouchableOpacity>
          
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
        
        <View style={styles.rightPanel}>
          <Text style={styles.roomListTitle}>房间列表</Text>
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#6A89A7" />
              <Text>加载房间中...</Text>
            </View>
          ) : (
            <RoomList serverAddr={serverAddr} navigation={navigation} roomInfoList={rooms} />
          )}
        </View>
      </View>
    </View>
  );
}

export default function App(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Game" component={Game} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  homeContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: '#BDDDFC',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#6A89A7',
    marginVertical: 20,
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPanel: {
    flex: 1,
    justifyContent: 'space-around',
    paddingHorizontal: 10,
  },
  rightPanel: {
    flex: 1,
    paddingHorizontal: 10,
  },
  nameInput: {
    backgroundColor: '#88BDF2',
    height: 50,
    width: 200,
    alignSelf: 'center',
    borderRadius: 10,
    padding: 10,
    fontSize: 18,
    color: 'white',
    marginBottom: 20,
  },
  createButton: {
    backgroundColor: '#6A89A7',
    height: 50,
    width: 200,
    alignSelf: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  createButtonText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  roomListTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#6A89A7',
    marginBottom: 10,
  },
  roomListContainer: {
    flex: 1,
    backgroundColor: '#88BDF2',
    borderRadius: 10,
    padding: 10,
  },
  roomElement: {
    backgroundColor: '#6A89A7',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    marginBottom: 10,
    borderRadius: 10,
  },
  roomInfo: {
    flex: 1,
  },
  roomIdText: {
    color: 'white',
    fontSize: 16,
  },
  playerCountText: {
    color: '#E0E0E0',
    fontSize: 14,
    marginTop: 5,
  },
  noRoomsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noRoomsText: {
    fontSize: 18,
    color: '#6A89A7',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  noRoomsHint: {
    fontSize: 14,
    color: '#6A89A7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#D32F2F',
    marginTop: 10,
    textAlign: 'center',
  },
});