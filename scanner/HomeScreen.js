
import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        

        
        <Text style={styles.subtitle}>
          Choose how you want to get started.
        </Text>

        <Pressable
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Scanner')}
        >
          <Text style={styles.primaryText}>  Start Scanning</Text>
          <Text style={styles.description}>
         Scan assessment papers using your camera
          </Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
       onPress={() => navigation.navigate('UploadFiles')}
        >
          <Text style={styles.secondaryText}>  Upload Files</Text>
          <Text style={styles.description}>
            Open your folders to manage assessment records
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 3,
    marginBottom: 45,
    color: '#111',
  },
  heading: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111',
  },
  subtitle: {
    fontSize: 15,
    color: '#777',
    marginTop: 8,
    marginBottom: 35,
  },
  primaryButton: {
    backgroundColor: '#111',
    padding: 20,
    borderRadius: 14,
    marginBottom: 16,
  },
  primaryText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: '#f3f4f6',
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  secondaryText: {
    color: '#111',
    fontSize: 18,
    fontWeight: 'bold',
  },
  description: {
    color: '#999',
    fontSize: 12,
    marginTop: 8,
  },
});
