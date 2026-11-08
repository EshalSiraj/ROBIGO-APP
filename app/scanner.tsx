
import { useLocalSearchParams, useRouter } from 'expo-router';
import ScannerScreen from '../scanner/ScannerScreen';

export default function ScannerRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    code?: string;
    assessment?: string;
  }>();

 /* const navigation = {
    replace: (screen: string) => {
      if (screen === 'Folders') {
        router.replace('/folders');
      }
    },
  }; */

  const navigation = {
  replace: (screen: string) => {
    if (screen === 'Folders') {
      router.replace('/(tabs)/classes');
    }
  },
};

  return (
    <ScannerScreen
      navigation={navigation}
      mode={params.mode}
      code={params.code}
      assessment={params.assessment}
    />
  );
}
