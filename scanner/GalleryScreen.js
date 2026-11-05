// screens/GalleryScreen.js
//
// Review screen at the end of a session:
//   - every page with its number, status and OCR text
//   - blurry / duplicate pages are already blocked while scanning; anything
//     that still slips through is badged here and can be removed in one tap
//   - upload the remaining pages to the backend
//
// Voice is owned by ScannerScreen (one listener for the whole app) and passed in.

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Modal,
  Dimensions,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SCANS_DIR } from './pageStore.js';
import { findBlurry, findDuplicates } from './pageLogic.js';

const screenWidth = Dimensions.get('window').width;
const THUMB_W = (screenWidth - 48) / 3;
const THUMB_H = THUMB_W * 1.3;

export default function GalleryScreen({
  pages,
  voice,
  toast,
  upload,
  onUpload,
  onCommand,
  onClose,
  onContinueToFolders,
}) {
  const [selected, setSelected] = useState(null);

  const { blurry, dups } = useMemo(() => {
    const b = new Set(findBlurry(pages));
    return { blurry: b, dups: new Set(findDuplicates(pages.filter((p) => !b.has(p.file)))) };
  }, [pages]);

  const busy = pages.filter((p) => p.saving || p.ocrStatus === 'pending').length;
  const uploading = upload && !upload.finished;
  const notUploaded = pages.filter((p) => !p.uploaded).length;
  const problems = blurry.size + dups.size;

  const deleteOne = (index) => {
    setSelected(null);
    onCommand({ action: 'deletePage', page: index + 1 });
  };

  let uploadLabel = `Upload ${notUploaded} page${notUploaded === 1 ? '' : 's'}`;
  if (uploading) uploadLabel = `Uploading ${upload.done}/${upload.total}…`;
  else if (pages.length > 0 && notUploaded === 0) uploadLabel = 'All pages uploaded ✓';
  else if (upload?.finished && upload.uploaded < upload.total) uploadLabel = `Retry upload (${notUploaded} left)`;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} accessibilityLabel="Back to scanner">
            <Text style={styles.backText}>‹ Scanner</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.micButton, voice.micOn && styles.micButtonOn]}
            onPress={voice.toggle}
            accessibilityLabel={voice.micOn ? 'Turn voice commands off' : 'Turn voice commands on'}
          >
            <Text style={styles.micText}>{voice.micOn ? '🎙️ Listening' : '🎙️ Voice'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>
          {pages.length} page{pages.length === 1 ? '' : 's'} scanned
        </Text>
        <Text style={styles.subtle}>
          {busy > 0
            ? `Reading text… ${busy} page${busy === 1 ? '' : 's'} left`
            : problems > 0
              ? `${problems} page${problems === 1 ? '' : 's'} need attention`
              : pages.length > 0
                ? 'All pages look good ✓'
                : ''}
        </Text>

        {problems > 0 && (
          <View style={styles.actionRow}>
            {dups.size > 0 && (
              <ActionButton
                label={`Remove ${dups.size} duplicate${dups.size === 1 ? '' : 's'}`}
                disabled={uploading}
                onPress={() => onCommand({ action: 'deleteDuplicates' })}
              />
            )}
            {blurry.size > 0 && (
              <ActionButton
                label={`Remove ${blurry.size} blurry`}
                disabled={uploading}
                onPress={() => onCommand({ action: 'deleteBlurry' })}
              />
            )}
          </View>
        )}
        <View style={styles.actionRow}>
          <ActionButton label="Undo" disabled={uploading} onPress={() => onCommand({ action: 'undo' })} />
        </View>

        {(toast || voice.error || (voice.micOn && voice.heard)) && (
          <View style={styles.toast}>
            {voice.micOn && voice.heard ? <Text style={styles.heard}>Heard: “{voice.heard}”</Text> : null}
            {toast ? <Text style={styles.toastText}>{toast}</Text> : null}
            {voice.error ? <Text style={styles.errorText}>{voice.error}</Text> : null}
          </View>
        )}
        {voice.micOn && (
          <Text style={styles.subtle}>
            Say: “delete page 3”, “delete last page”, “clean up”, “undo”, “upload”
          </Text>
        )}
      </View>

      {pages.length === 0 ? (
        <Text style={styles.infoText}>No pages scanned yet.</Text>
      ) : (
        <FlatList
          data={pages}
          keyExtractor={(item) => item.file}
          numColumns={3}
          contentContainerStyle={styles.grid}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              onPress={() => !item.saving && setSelected({ ...item, index })}
              accessibilityLabel={`Page ${index + 1}`}
            >
              {item.saving ? (
                <View style={[styles.thumb, styles.thumbPending]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : (
                <Image source={{ uri: SCANS_DIR + item.file }} style={styles.thumb} />
              )}
              <View style={styles.pageNo}>
                <Text style={styles.pageNoText}>{index + 1}</Text>
              </View>
              <View style={styles.badges}>
                {blurry.has(item.file) && <Text style={[styles.badge, styles.badgeBlur]}>Blurry</Text>}
                {dups.has(item.file) && <Text style={[styles.badge, styles.badgeDup]}>Duplicate</Text>}
                {item.warning && <Text style={[styles.badge, styles.badgeWarn]}>Check</Text>}
                {item.uploaded && <Text style={[styles.badge, styles.badgeUp]}>Uploaded</Text>}
              </View>
              <Text style={styles.thumbLabel} numberOfLines={1}>
                {item.saving
                  ? 'Saving…'
                  : item.ocrStatus === 'pending'
                    ? 'Reading…'
                    : item.ocrStatus === 'failed'
                      ? 'Text: server will read'
                      : item.words
                        ? `${item.words} words read`
                        : item.text
                          ? 'Text ✓'
                          : 'No text found'}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

     <View style={styles.footer}>
  <TouchableOpacity
    style={[
      styles.uploadBtn,
      (notUploaded === 0 || uploading) && styles.disabled,
    ]}
    disabled={notUploaded === 0 || uploading}
    onPress={onUpload}
  >
    <Text style={styles.uploadText}>{uploadLabel}</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={styles.continueBtn}
    onPress={onContinueToFolders}
  >
    <Text style={styles.continueText}>Continue to Folders →</Text>
  </TouchableOpacity>
</View>

      <Modal visible={!!selected} animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalTop}>
            {selected && (
              <TouchableOpacity onPress={() => deleteOne(selected.index)} style={styles.modalBtn}>
                <Text style={styles.modalDelete}>Delete page</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setSelected(null)} style={styles.modalBtn}>
              <Text style={styles.modalCloseText}>Close ✕</Text>
            </TouchableOpacity>
          </View>
          {selected && (
            <>
              <Image source={{ uri: SCANS_DIR + selected.file }} style={styles.fullImage} resizeMode="contain" />
              <ScrollView style={styles.textBox}>
                <Text style={styles.textLabel}>
                  Page {selected.index + 1} · sharpness{' '}
                  {Number.isFinite(selected.sharpness) ? Math.round(selected.sharpness * 100) + '%' : '–'}
                  {selected.cropped ? ' · cropped to page' : ''}
                  {selected.manual ? ' · captured manually' : ''}
                  {selected.warning === 'keptAnyway' ? ' · kept although hard to read' : ''}
                  {selected.warning === 'littleText' ? ' · hardly any text found' : ''}
                </Text>
                <Text selectable style={styles.ocrText}>
                  {selected.ocrStatus === 'pending'
                    ? 'Reading text…'
                    : selected.ocrStatus === 'failed'
                      ? 'Text could not be read on the phone. It will be read on the server after upload.'
                      : selected.text || 'No text found on this page.'}
                </Text>
              </ScrollView>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

function ActionButton({ label, onPress, disabled }) {
  return (
    <TouchableOpacity style={[styles.action, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  header: { paddingTop: 48, paddingHorizontal: 16, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn: { minHeight: 44, justifyContent: 'center', paddingRight: 12 },
  backText: { color: '#60a5fa', fontSize: 17, fontWeight: '600' },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 4 },
  subtle: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  infoText: { color: '#aaa', textAlign: 'center', marginTop: 40 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  action: { backgroundColor: '#334155', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, minHeight: 40 },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  micButton: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, minHeight: 40 },
  micButtonOn: { backgroundColor: '#dc2626' },
  micText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  toast: { marginTop: 8, backgroundColor: '#1e293b', padding: 10, borderRadius: 10 },
  heard: { color: '#cbd5e1', fontSize: 12, fontStyle: 'italic' },
  toastText: { color: '#86efac', fontSize: 14, fontWeight: '700' },
  errorText: { color: '#fca5a5', fontSize: 13 },
  grid: { paddingHorizontal: 12, paddingBottom: 110 },
  thumb: { width: THUMB_W, height: THUMB_H, margin: 4, borderRadius: 8, backgroundColor: '#333' },
  thumbPending: { alignItems: 'center', justifyContent: 'center' },
  pageNo: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    minWidth: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  pageNoText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  badges: { position: 'absolute', top: 8, left: 8, gap: 2 },
  badge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  badgeBlur: { backgroundColor: '#dc2626' },
  badgeDup: { backgroundColor: '#ea580c' },
  badgeUp: { backgroundColor: '#15803d' },
  badgeWarn: { backgroundColor: '#ca8a04' },
  thumbLabel: { color: '#ccc', fontSize: 11, textAlign: 'center', width: THUMB_W, marginBottom: 6 },
  footer: { position: 'absolute', bottom: 24, left: 16, right: 16 },
  uploadBtn: { backgroundColor: '#2563eb', paddingVertical: 15, borderRadius: 30, alignItems: 'center' },
  uploadText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalContainer: { flex: 1, backgroundColor: '#000', paddingTop: 48 },
  modalTop: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  modalBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  modalDelete: { color: '#f87171', fontSize: 16, fontWeight: '700' },
  modalCloseText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fullImage: { width: '100%', height: '55%' },
  textBox: { flex: 1, margin: 12, backgroundColor: '#111827', borderRadius: 10, padding: 12 },
  textLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 6 },
  ocrText: { color: '#f1f5f9', fontSize: 14, lineHeight: 20 },

  continueBtn: {
  backgroundColor: '#334155',
  paddingVertical: 14,
  borderRadius: 30,
  alignItems: 'center',
  marginTop: 10,
},
continueText: {
  color: '#fff',
  fontSize: 15,
  fontWeight: '700',
},
});
