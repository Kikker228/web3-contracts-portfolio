require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// The sandbox cannot download native solc binaries, so we fall back to the
// solcjs build shipped with the `solc` npm package. On a normal machine you
// can delete this block and Hardhat will download the native compiler.
if (process.env.USE_SOLCJS === "1") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion === "0.8.26") {
      const compilerPath = require.resolve("solc/soljson.js");
      const solc = require("solc");
      return {
        compilerPath,
        isSolcJs: true,
        version: args.solcVersion,
        longVersion: solc.version(),
      };
    }
    return runSuper();
  });
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } },
  },
};
