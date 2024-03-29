# Mauve Periphery

<!-- TODO: TO UPDATE -->

[![Tests](https://github.com/violetprotocol/mauve-periphery/workflows/Tests/badge.svg)](https://github.com/violetprotocol/mauve-periphery/actions?query=workflow%3ATests)
[![Lint](https://github.com/violetprotocol/mauve-periphery/workflows/Lint/badge.svg)](https://github.com/violetprotocol/mauve-periphery/actions?query=workflow%3ALint)

This repository contains the periphery smart contracts for the Mauve Protocol.
For the lower level core contracts, see the [mauve-core](https://github.com/violetprotocol/mauve-core)
repository.

NonfungiblePositionManager operates a specific guarding mechanism to protect against unauthorised function calls. The diagram below illustrates this through an example where a user attempts to perform a multicall transaction.

<img width="1713" alt="callstates" src="https://user-images.githubusercontent.com/89014495/236201268-fc618b4b-2de5-421a-bb3d-598aadc96a1b.png">

## Local deployment

In order to deploy this code to a local testnet, you should install the npm package
`@violetprotocol/mauve-periphery`
and import bytecode imported from artifacts located at
`@violetprotocol/mauve-periphery/artifacts/contracts/*/*.json`.
For example:

```typescript
import {
  abi as MOCK_SWAP_ROUTER_ABI,
  bytecode as MOCK_SWAP_ROUTER_BYTECODE,
} from '@violetprotocol/mauve-periphery/artifacts/contracts/MockSwapRouter.sol/MockSwapRouter.json'

// deploy the bytecode
```

This will ensure that you are testing against the same bytecode that is deployed to
mainnet and public testnets, and all Mauve code will correctly interoperate with
your local deployment.

## Using solidity interfaces

The Mauve periphery interfaces are available for import into solidity smart contracts
via the npm artifact `@violetprotocol/mauve-periphery`, e.g.:

```solidity
import '@violetprotocol/mauve-periphery/contracts/interfaces/IMockSwapRouter.sol';

contract MyContract {
  IMockSwapRouter router;

  function doSomethingWithMockSwapRouter() {
    // router.exactInput(...);
  }
}

```
