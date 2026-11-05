import React from 'react';
import { useRouter } from 'expo-router';
import UploadFilesScreen from '../scanner/UploadFilesScreen';
export default function UploadFilesRoute() {
  const router = useRouter();
  const navigation = {
    goBack: () => router.back(),
  };
  return <UploadFilesScreen navigation={navigation} />;
}
