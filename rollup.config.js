import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import babel from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import pkg from './package.json';

const externalSet = new Set([
  '@kubric/utils',
  '@kubric/resolver',
  'superagent',
]);

export default [
  {
    input: 'src/index.js',
    output: [
      {
        file: pkg.main,
        format: 'cjs',
        sourcemap: 'inline',
      },
      {
        file: pkg.module,
        format: 'esm',
        sourcemap: 'inline',
      },
    ],
    plugins: [
      babel({
        babelrc: false,
        exclude: 'node_modules/**',
        presets: [require('@babel/preset-env')],
        plugins: [
          require('@babel/plugin-proposal-class-properties'),
          require('@babel/plugin-proposal-function-bind'),
          require('@babel/plugin-proposal-object-rest-spread'),
        ],
        extensions: ['.js'],
      }),
      resolve(),
      commonjs(),
      json(),
      // terser(),
    ],
    external: (id) => id.includes('@babel/runtime') || externalSet.has(id),
  },
];
