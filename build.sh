pushd z3-npm
npx webpack --mode production
cp dist/main.js ../z3-built/main.js
popd