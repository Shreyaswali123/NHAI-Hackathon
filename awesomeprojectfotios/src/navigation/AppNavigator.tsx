import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import RegisterScreen from '../screens/RegisterScreen';
import ScanningScreen from '../screens/ScanningScreen';
import ResultScreen from '../screens/ResultScreen';

export type RootStackParamList = {
  Register: undefined;
  Scanning: undefined;
  Result: {
    success: boolean;
    confidence: number;
    timestamp: string;
    userId: string;
  };
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Register"
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#0D0D0D' },
        }}
      >
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Scanning" component={ScanningScreen} />
        <Stack.Screen name="Result" component={ResultScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
