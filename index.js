/**
 * @format
 */
import 'react-native-get-random-values';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import { v4 as uuidv4 } from 'uuid';

AppRegistry.registerComponent(appName, () => App);

export const playerIdGlobal = uuidv4();