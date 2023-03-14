// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;
pragma abicoder v2;

import '../base/EATMulticallPeripheryPayments.sol';
import '../base/EATMulticallPeripheryPaymentsWithFee.sol';

contract TestEATMulticallPeripheryPayments is EATMulticallPeripheryPayments {
    constructor(
        address _factory,
        address _WETH9,
        address _EATVerifier
    ) PeripheryImmutableState(_factory, _WETH9) EATMulticall(_EATVerifier) {}
}

contract TestEATMulticallPeripheryPaymentsWithFee is EATMulticallPeripheryPaymentsWithFee {
    constructor(
        address _factory,
        address _WETH9,
        address _EATVerifier
    ) PeripheryImmutableState(_factory, _WETH9) EATMulticall(_EATVerifier) {}
}
