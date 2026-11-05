import AsyncStorage from '@react-native-async-storage/async-storage';

// Which class and quiz the teacher is working on. Home reads this; My classes and Class details set it.
const KEY = 'tmate.selection.v1';
export type Selection = { code: string; quiz: string };
const blank: Selection = { code: '', quiz: 'Quiz 1' };

export async function getSelection(): Promise<Selection> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...blank, ...(JSON.parse(raw) as Selection) } : blank;
  } catch {
    return blank;
  }
}

export async function setSelection(code: string, quiz: string = 'Quiz 1'): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ code, quiz }));
  } catch {
    // Not critical.
  }
}
