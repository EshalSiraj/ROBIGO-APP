
import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function UploadFilesScreen({ navigation }) {
  const [files, setFiles] = useState([]);

  const selectFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const selectedFiles = result.assets || [];

      setFiles(previous => {
        const existingUris = new Set(previous.map(file => file.uri));
        const newFiles = selectedFiles.filter(
          file => !existingUris.has(file.uri)
        );

        return [...previous, ...newFiles];
      });
    } catch (error) {
      Alert.alert('Error', 'Unable to select files.');
      console.error('Document picker error:', error);
    }
  };

  const removeFile = (uri) => {
    setFiles(previous => previous.filter(file => file.uri !== uri));
  };

  const clearFiles = () => {
    Alert.alert(
      'Clear selection',
      'Remove all selected files?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => setFiles([]),
        },
      ]
    );
  };

  const formatSize = (bytes) => {
    if (bytes == null) return 'Size unavailable';
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const renderFile = ({ item, index }) => {
    const isPdf = item.mimeType === 'application/pdf';

    return (
      <View style={styles.fileCard}>
        <View style={styles.fileIcon}>
          <Text style={styles.iconText}>{isPdf ? 'PDF' : 'IMG'}</Text>
        </View>

        <View style={styles.fileInfo}>
          <Text style={styles.fileName} numberOfLines={2}>
            {item.name || `File ${index + 1}`}
          </Text>
          <Text style={styles.fileSize}>
            {formatSize(item.size)}
          </Text>
        </View>

        <Pressable
          onPress={() => removeFile(item.uri)}
          style={styles.removeButton}
          accessibilityLabel={`Remove ${item.name}`}
        >
          <Text style={styles.removeText}>✕</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.heading}>Upload Files</Text>
        <Text style={styles.subtitle}>
          Select assessment papers from your device.
        </Text>
      </View>

      <Pressable style={styles.selectButton} onPress={selectFiles}>
        <Text style={styles.selectIcon}>＋</Text>
        <Text style={styles.selectTitle}>Choose Files</Text>
        <Text style={styles.selectSubtitle}>
          Select multiple PDFs or images
        </Text>
      </Pressable>

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>
          Selected Files ({files.length})
        </Text>

        {files.length > 0 && (
          <Pressable onPress={clearFiles}>
            <Text style={styles.clearText}>Clear all</Text>
          </Pressable>
        )}
      </View>

      {files.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyTitle}>No files selected</Text>
          <Text style={styles.emptySubtitle}>
            Your selected files will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item.uri}
          renderItem={renderFile}
          contentContainerStyle={styles.fileList}
        />
      )}

      <View style={styles.footer}>
        <Pressable
          style={[
            styles.uploadButton,
            files.length === 0 && styles.disabled,
          ]}
          disabled={files.length === 0}
          onPress={() =>
            Alert.alert(
              'Files selected',
              `${files.length} file(s) are ready. Connect the ROBIGO backend to upload and process them.`
            )
          }
        >
          <Text style={styles.uploadText}>
            Prepare {files.length} File{files.length === 1 ? '' : 's'}
          </Text>
        </Pressable>

        <Text style={styles.footerNote}>
          Files are selected locally. Server upload is not connected yet.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
  },
  backText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 22,
  },
  heading: {
    fontSize: 27,
    fontWeight: 'bold',
    color: '#111',
  },
  subtitle: {
    color: '#777',
    fontSize: 14,
    marginTop: 7,
  },
  selectButton: {
    marginHorizontal: 20,
    marginTop: 10,
    padding: 25,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#2563eb',
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#f8faff',
  },
  selectIcon: {
    fontSize: 32,
    color: '#2563eb',
  },
  selectTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    marginTop: 8,
    color: '#111',
  },
  selectSubtitle: {
    color: '#777',
    fontSize: 12,
    marginTop: 5,
  },
  listHeader: {
    marginHorizontal: 20,
    marginTop: 28,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#111',
  },
  clearText: {
    color: '#dc2626',
    fontWeight: '600',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 30,
  },
  emptyIcon: {
    fontSize: 42,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtitle: {
    color: '#888',
    marginTop: 5,
    fontSize: 13,
  },
  fileList: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    marginBottom: 10,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: 'bold',
  },
  fileInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  fileName: {
    color: '#111',
    fontWeight: '600',
    fontSize: 13,
  },
  fileSize: {
    color: '#888',
    fontSize: 11,
    marginTop: 5,
  },
  removeButton: {
    padding: 10,
  },
  removeText: {
    color: '#dc2626',
    fontSize: 17,
    fontWeight: 'bold',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  uploadButton: {
    backgroundColor: '#111',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  uploadText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footerNote: {
    color: '#888',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 9,
  },
});
