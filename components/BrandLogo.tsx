
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

type Props = {
  size?: number;
};

export default function BrandLogo({ size = 110 }: Props) {
  return (
    <View style={styles.container}>
      <Image
        source={require('../assets/images/robigo-logo.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
