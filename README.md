# Mauve Periphery

<!-- TODO: TO UPDATE -->

[![Tests](https://github.com/violetprotocol/mauve-periphery/workflows/Tests/badge.svg)](https://github.com/violetprotocol/mauve-periphery/actions?query=workflow%3ATests)
[![Lint](https://github.com/violetprotocol/mauve-periphery/workflows/Lint/badge.svg)](https://github.com/violetprotocol/mauve-periphery/actions?query=workflow%3ALint)

This repository contains the periphery smart contracts for the Mauve Protocol.
For the lower level core contracts, see the [mauve-core](https://github.com/violetprotocol/mauve-core)
repository.

## Bug bounty

This repository is subject to the Mauve bug bounty program,
per the terms defined [here](./bug-bounty.md).

## Local deployment

In order to deploy this code to a local testnet, you should install the npm package
`@violetprotocol/mauve-periphery`
and import bytecode imported from artifacts located at
`@violetprotocol/mauve-periphery/artifacts/contracts/*/*.json`.
For example:

```typescript
import {
  abi as SWAP_ROUTER_ABI,
  bytecode as SWAP_ROUTER_BYTECODE,
} from '@violetprotocol/mauve-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'

// deploy the bytecode
```

This will ensure that you are testing against the same bytecode that is deployed to
mainnet and public testnets, and all Mauve code will correctly interoperate with
your local deployment.

## Using solidity interfaces

The Mauve periphery interfaces are available for import into solidity smart contracts
via the npm artifact `@violetprotocol/mauve-periphery`, e.g.:

```solidity
import '@violetprotocol/mauve-periphery/contracts/interfaces/ISwapRouter.sol';

contract MyContract {
  ISwapRouter router;

  function doSomethingWithSwapRouter() {
    // router.exactInput(...);
  }
}

```
