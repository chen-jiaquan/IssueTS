<template>
  <div class="nf">
    <el-result icon="warning" title="404" sub-title="页面不存在">
      <template #extra>
        <router-link to="/home"><el-button type="primary">回首页</el-button></router-link>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.nf { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
</style>
