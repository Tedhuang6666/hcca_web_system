<template>
  <div v-html="sanitized" />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { customSanitize } from 'src/ts/utils';

const props = defineProps<{
  content: string;
}>();

const sanitized = ref('');

watch(
  () => props.content,
  async (val) => {
    if (val) {
      sanitized.value = await customSanitize(val);
    } else {
      sanitized.value = '';
    }
  },
  { immediate: true },
);
</script>
