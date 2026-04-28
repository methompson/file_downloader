<template>
  <VApp>
    <VContainer>
      <VRow>
        <VCol cols="12">
          <VBtn @click="fetchDownloads">Fetch Downloads</VBtn>
        </VCol>

        <VCol cols="12">
          <VBtn @click="fetchDownloads">Fetch Downloads</VBtn>
        </VCol>
      </VRow>
    </VContainer>
  </VApp>
</template>

<script setup lang="ts">
import { getDownloads } from '@/api/get_downloads';

async function fetchDownloads() {
  try {
    const result = await getDownloads();
    console.log(result);
  } catch {
    console.error('Error getting downloads');
  }
}
</script>
