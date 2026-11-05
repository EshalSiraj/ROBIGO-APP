import React from 'react';
import { useRouter } from 'expo-router';
import FoldersScreen from '../scanner/Folderscreen';
export default function FoldersRoute() {
  const router = useRouter();
  const navigation = {
    navigate: (screen: string, params?: any) => {
      if (screen === 'Scanner') {
        router.push('/scanner');
      }
    },
  };
  return <FoldersScreen navigation={navigation} />;
}
