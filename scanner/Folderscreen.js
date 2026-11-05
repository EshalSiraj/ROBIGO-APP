
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const INITIAL_FOLDERS = [
  {
    id: 'f1',
    name: 'Fall 2026 - Batch 2022',
    course: 'Data Structures',
    quizzes: [
      { id: 'q1', name: 'Quiz 1', scanned: 31, total: 31 },
      { id: 'q2', name: 'Midterm', scanned: 12, total: 31 },
      { id: 'q3', name: 'Quiz 2', scanned: 0, total: 0 },
    ],
  },
  {
    id: 'f2',
    name: 'Fall 2026 - Batch 2023',
    course: 'Database Systems',
    quizzes: [],
  },
  {
    id: 'f3',
    name: 'Spring 2026 - Batch 2022',
    course: 'Operating Systems',
    quizzes: [],
  },
];

export default function FoldersScreen({ navigation }) {
  const [folders, setFolders] = useState(INITIAL_FOLDERS);
  const [folderId, setFolderId] = useState('f1');
  const [quizId, setQuizId] = useState('q2');
  const [modal, setModal] = useState(null);
  const [name, setName] = useState('');

  const folder = folders.find(f => f.id === folderId);
  const quiz = folder?.quizzes.find(q => q.id === quizId);

  const addFolder = () => {
    if (!name.trim()) return;

    const newFolder = {
      id: Date.now().toString(),
      name: name.trim(),
      course: 'No course set',
      quizzes: [],
    };

    setFolders(prev => [...prev, newFolder]);
    setFolderId(newFolder.id);
    setQuizId(null);
    setName('');
    setModal(null);
  };

  const addQuiz = () => {
    if (!name.trim()) return;

    const newQuiz = {
      id: Date.now().toString(),
      name: name.trim(),
      scanned: 0,
      total: 0,
    };

    setFolders(prev =>
      prev.map(f =>
        f.id === folderId
          ? { ...f, quizzes: [...f.quizzes, newQuiz] }
          : f
      )
    );

    setQuizId(newQuiz.id);
    setName('');
    setModal(null);
  };

  const startScanning = () => {
    if (!quiz) {
      Alert.alert('Select a quiz', 'Please select a quiz first.');
      return;
    }

    navigation.navigate('Scanner', { folder, quiz });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        
        <Text style={styles.logo}>ROBIGO</Text>
        <Text style={styles.heading}>My Folders</Text>

        {/* Folders */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Folders</Text>
          <Pressable onPress={() => setModal('folder')}>
            <Text style={styles.addButton}>+ Add Folder</Text>
          </Pressable>
        </View>

        {folders.map(f => (
          <Pressable
            key={f.id}
            onPress={() => {
              setFolderId(f.id);
              setQuizId(null);
            }}
            style={[
              styles.folder,
              folderId === f.id && styles.selectedFolder,
            ]}
          >
            <Text
              style={[
                styles.folderName,
                folderId === f.id && styles.selectedText,
              ]}
            >
              📁 {f.name}
            </Text>

            <Text
              style={[
                styles.subText,
                folderId === f.id && styles.selectedSubText,
              ]}
            >
              {f.course} · {f.quizzes.length} quizzes
            </Text>
          </Pressable>
        ))}

        {/* Quizzes */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Quizzes</Text>
          <Pressable
            onPress={() => {
              if (!folder) return;
              setModal('quiz');
            }}
          >
            <Text style={styles.addButton}>+ Add Quiz</Text>
          </Pressable>
        </View>

        {folder?.quizzes.length === 0 && (
          <Text style={styles.emptyText}>
            No quizzes yet. Add your first quiz.
          </Text>
        )}

        {folder?.quizzes.map(q => (
          <Pressable
            key={q.id}
            onPress={() => setQuizId(q.id)}
            style={[
              styles.quiz,
              quizId === q.id && styles.selectedQuiz,
            ]}
          >
            <Text style={styles.quizName}>
              {quizId === q.id ? '🔘' : '⚪'} {q.name}
            </Text>

            <Text style={styles.subText}>
              {q.scanned === 0
                ? 'Not scanned'
                : `${q.scanned}/${q.total} scanned`}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Scan Button */}
      <View style={styles.bottom}>
        <Pressable style={styles.scanButton} onPress={startScanning}>
          <Text style={styles.scanText}>📷  Start Scanning</Text>
        </Pressable>
      </View>

      {/* Add Folder / Quiz Modal */}
      <Modal visible={!!modal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>
              {modal === 'folder' ? 'New Folder' : 'New Quiz'}
            </Text>

            <TextInput
              style={styles.input}
              placeholder={
                modal === 'folder'
                  ? 'Enter folder name'
                  : 'Enter quiz name'
              }
              value={name}
              onChangeText={setName}
            />

            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => {
                  setModal(null);
                  setName('');
                }}
              >
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={modal === 'folder' ? addFolder : addQuiz}
              >
                <Text style={styles.save}>Create</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    padding: 20,
    paddingBottom: 30,
  },
  logo: {
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 25,
  },
  heading: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  addButton: {
    color: '#333',
    fontWeight: '600',
  },
  folder: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 10,
  },
  selectedFolder: {
    backgroundColor: '#f0f0f0',
    borderColor: '#222',
  },
  folderName: {
    fontSize: 15,
    fontWeight: '600',
  },
  selectedText: {
    color: '#000',
  },
  subText: {
    color: '#777',
    fontSize: 13,
    marginTop: 5,
  },
  selectedSubText: {
    color: '#555',
  },
  quiz: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    marginBottom: 8,
  },
  selectedQuiz: {
    borderColor: '#222',
    backgroundColor: '#f7f7f7',
  },
  quizName: {
    fontSize: 15,
    fontWeight: '500',
  },
  emptyText: {
    color: '#777',
    paddingVertical: 15,
  },
  bottom: {
    padding: 15,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  scanButton: {
    backgroundColor: '#111',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  scanText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  overlay: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'center',
    padding: 25,
  },
  modal: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 25,
  },
  cancel: {
    color: '#555',
    fontWeight: '600',
  },
  save: {
    color: '#000',
    fontWeight: 'bold',
  },
});
