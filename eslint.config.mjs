import { defineConfig, globalIgnores } from "eslint/config"
import next from "eslint-config-next"

const eslintConfig = defineConfig([
  ...next,
  globalIgnores([".next/**", "node_modules/**", "out/**", "next-env.d.ts"]),
])

export default eslintConfig
