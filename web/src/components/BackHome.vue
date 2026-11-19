<script setup>
// 各功能页返回工作台的统一入口
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <el-button @click="router.push('/home')">返回工作台</el-button>
</template>
