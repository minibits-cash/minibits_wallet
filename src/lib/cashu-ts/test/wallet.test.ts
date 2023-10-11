import { decode } from '@gandlaf21/bolt11-decode';
import nock from 'nock';
import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';

const dummyKeysResp = { 1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181' };
const mintUrl = 'https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC';
const mint = new CashuMint(mintUrl);
const invoice =
	'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

beforeAll(() => {
	nock.disableNetConnect();
});

beforeEach(() => {
	nock.cleanAll();
	nock(mintUrl).get('/keys').reply(200, dummyKeysResp);
});

describe('test fees', () => {
	test('test get fees', async () => {
		nock(mintUrl).post('/checkfees').reply(200, { fee: 20 });
		const wallet = new CashuWallet(mint);

		const fee = await wallet.getFee(invoice);
		const amount = decode(invoice).sections[2].value / 1000;

		expect(fee + amount).toEqual(2020);
	});
});

describe('receive', () => {
	const tokenInput =
		'eyJwcm9vZnMiOlt7ImlkIjoiL3VZQi82d1duWWtVIiwiYW1vdW50IjoxLCJzZWNyZXQiOiJBZmtRYlJYQUc1UU1tT3ArbG9vRzQ2OXBZWTdiaStqbEcxRXRDT2tIa2hZPSIsIkMiOiIwMmY4NWRkODRiMGY4NDE4NDM2NmNiNjkxNDYxMDZhZjdjMGYyNmYyZWUwYWQyODdhM2U1ZmE4NTI1MjhiYjI5ZGYifV0sIm1pbnRzIjpbeyJ1cmwiOiJodHRwczovL2xlZ2VuZC5sbmJpdHMuY29tL2Nhc2h1L2FwaS92MS80Z3I5WGNtejNYRWtVTndpQmlRR29DIiwiaWRzIjpbIi91WUIvNndXbllrVSJdfV19';
		test('test receive', async () => {
			nock(mintUrl)
				.post('/split')
				.reply(200, {
					promises: [
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			const wallet = new CashuWallet(mint);
	
			const { token: t, tokensWithErrors } = await wallet.receive(tokenInput);
	
			expect(t.token).toHaveLength(1);
			expect(t.token[0].proofs).toHaveLength(1);
			expect(t.token[0]).toMatchObject({
				proofs: [{ amount: 1, id: 'z32vUtKgNCm1' }],
				mint: 'https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC'
			});
			expect(/[0-9a-f]{64}/.test(t.token[0].proofs[0].C)).toBe(true);
			expect(/[A-Za-z0-9+/]{43}=/.test(t.token[0].proofs[0].secret)).toBe(true);
			expect(tokensWithErrors).toBe(undefined);
		});
		test('test receive custom split', async () => {
			nock(mintUrl)
				.post('/split')
				.reply(200, {
					promises: [
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						},
						{
							id: 'z32vUtKgNCm1',
							amount: 1,
							C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
						}
					]
				});
			const wallet = new CashuWallet(mint);
			const token3sat = 'eyJwcm9vZnMiOlt7ImlkIjoiL3VZQi82d1duWWtVIiwiYW1vdW50IjoxLCJzZWNyZXQiOiJBZmtRYlJYQUc1UU1tT3ArbG9vRzQ2OXBZWTdiaStqbEcxRXRDT2tIa2hZPSIsIkMiOiIwMmY4NWRkODRiMGY4NDE4NDM2NmNiNjkxNDYxMDZhZjdjMGYyNmYyZWUwYWQyODdhM2U1ZmE4NTI1MjhiYjI5ZGYifSx7ImlkIjoiL3VZQi82d1duWWtVIiwiYW1vdW50IjoxLCJzZWNyZXQiOiJBZmtRYlJYQUc1UU1tT3ArbG9vRzQ2OXBZWTdiaStqbEcxRXRDT2tIa2hZPSIsIkMiOiIwMmY4NWRkODRiMGY4NDE4NDM2NmNiNjkxNDYxMDZhZjdjMGYyNmYyZWUwYWQyODdhM2U1ZmE4NTI1MjhiYjI5ZGYifSx7ImlkIjoiL3VZQi82d1duWWtVIiwiYW1vdW50IjoxLCJzZWNyZXQiOiJBZmtRYlJYQUc1UU1tT3ArbG9vRzQ2OXBZWTdiaStqbEcxRXRDT2tIa2hZPSIsIkMiOiIwMmY4NWRkODRiMGY4NDE4NDM2NmNiNjkxNDYxMDZhZjdjMGYyNmYyZWUwYWQyODdhM2U1ZmE4NTI1MjhiYjI5ZGYifV0sIm1pbnRzIjpbeyJ1cmwiOiJodHRwczovL2xlZ2VuZC5sbmJpdHMuY29tL2Nhc2h1L2FwaS92MS80Z3I5WGNtejNYRWtVTndpQmlRR29DIiwiaWRzIjpbIi91WUIvNndXbllrVSJdfV19'
			const { token: t, tokensWithErrors } = await wallet.receive(token3sat, [{amount:1, count:3}]);
	
			expect(t.token).toHaveLength(1);
			expect(t.token[0].proofs).toHaveLength(3);
			expect(t.token[0]).toMatchObject({
				proofs: [{ amount: 1, id: 'z32vUtKgNCm1' },{ amount: 1, id: 'z32vUtKgNCm1' },{ amount: 1, id: 'z32vUtKgNCm1' }],
			});
			expect(/[0-9a-f]{64}/.test(t.token[0].proofs[0].C)).toBe(true);
			expect(/[A-Za-z0-9+/]{43}=/.test(t.token[0].proofs[0].secret)).toBe(true);
			expect(tokensWithErrors).toBe(undefined);
		});
	test('test receive tokens already spent', async () => {
		const msg = 'tokens already spent. Secret: oEpEuViVHUV2vQH81INUbq++Yv2w3u5H0LhaqXJKeR0=';
		nock(mintUrl).post('/split').reply(200, { detail: msg });
		const wallet = new CashuWallet(mint);

		const { tokensWithErrors } = await wallet.receive(tokenInput);
		const t = tokensWithErrors!;

		expect(tokensWithErrors).toBeDefined();
		expect(t.token).toHaveLength(1);
		expect(t.token[0].proofs).toHaveLength(1);
		expect(t.token[0]).toMatchObject({
			proofs: [{ amount: 1, id: '/uYB/6wWnYkU' }],
			mint: 'https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC'
		});
		expect(/[0-9a-f]{64}/.test(t.token[0].proofs[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(t.token[0].proofs[0].secret)).toBe(true);
	});
	test('test receive could not verify proofs', async () => {
		nock(mintUrl).post('/split').reply(200, { code: 0, error: 'could not verify proofs.' });
		const wallet = new CashuWallet(mint);

		const { tokensWithErrors } = await wallet.receive(tokenInput);
		const t = tokensWithErrors!;

		expect(tokensWithErrors).toBeDefined();
		expect(t.token).toHaveLength(1);
		expect(t.token[0].proofs).toHaveLength(1);
		expect(t.token[0]).toMatchObject({
			proofs: [{ amount: 1, id: '/uYB/6wWnYkU' }],
			mint: 'https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC'
		});
		expect(/[0-9a-f]{64}/.test(t.token[0].proofs[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(t.token[0].proofs[0].secret)).toBe(true);
	});
	test('test receive keys changed', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: 'test',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		nock(mintUrl).get('/keys/test').reply(200, {
			1: '0377a6fe114e291a8d8e991627c38001c8305b23b9e98b1c7b1893f5cd0dda6cad'
		});
		nock(mintUrl).get('/keys').reply(200, {
			1: '0377a6fe114e291a8d8e991627c38001c8305b23b9e98b1c7b1893f5cd0dda6cad'
		});
		const wallet = new CashuWallet(mint);

		const {
			token: { token },
			tokensWithErrors,
			newKeys
		} = await wallet.receive(tokenInput);

		expect(token[0].proofs).toHaveLength(1);
		expect(token[0].proofs[0]).toMatchObject({ amount: 1, id: 'test' });
		expect(/[0-9a-f]{64}/.test(token[0].proofs[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(token[0].proofs[0].secret)).toBe(true);
		expect(tokensWithErrors).toBe(undefined);
		expect(newKeys).toStrictEqual({
			1: '0377a6fe114e291a8d8e991627c38001c8305b23b9e98b1c7b1893f5cd0dda6cad'
		});
	});
});

describe('checkProofsSpent', () => {
	const proofs = [
		{
			id: '0NI3TUAs1Sfy',
			amount: 1,
			secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		}
	];
	test('test checkProofsSpent - get proofs that are NOT spendable', async () => {
		nock(mintUrl)
			.post('/check')
			.reply(200, { spendable: [true] });
		const wallet = new CashuWallet(mint);

		const result = await wallet.checkProofsSpent(proofs);

		expect(result).toStrictEqual([]);
	});
});

describe('payLnInvoice', () => {
	const proofs = [
		{
			id: '0NI3TUAs1Sfy',
			amount: 1,
			secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		}
	];
	test('test payLnInvoice base case', async () => {
		nock(mintUrl).post('/checkfees').reply(200, { fee: 0 });
		nock(mintUrl).post('/melt').reply(200, { paid: true, preimage: '' });
		const wallet = new CashuWallet(mint);

		const result = await wallet.payLnInvoice(invoice, proofs);

		expect(result).toEqual({ isPaid: true, preimage: '', change: [] });
	});
	test('test payLnInvoice change', async () => {
		nock.cleanAll();
		nock(mintUrl).get('/keys').reply(200, {
			1: '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
			2: '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5'
		});
		nock(mintUrl).post('/checkfees').reply(200, { fee: 2 });
		nock(mintUrl)
			.post('/melt')
			.reply(200, {
				paid: true,
				preimage: '',
				change: [
					{
						id: '+GmhrYs64zDj',
						amount: 2,
						C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const result = await wallet.payLnInvoice(invoice, [{ ...proofs[0], amount: 3 }]);

		expect(result.isPaid).toBe(true);
		expect(result.preimage).toBe('');
		expect(result.change).toHaveLength(1);
	});
	test('test payLnInvoice bad resonse', async () => {
		nock(mintUrl).post('/checkfees').reply(200, {});
		const wallet = new CashuWallet(mint);

		const result = await wallet.payLnInvoice(invoice, proofs).catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
	test('test payLnInvoice key changed', async () => {
		nock(mintUrl).post('/checkfees').reply(200, { fee: 2 });
		nock(mintUrl)
			.post('/melt')
			.reply(200, {
				paid: true,
				preimage: '',
				change: [
					{
						id: 'test',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		nock(mintUrl).get('/keys/test').reply(200, {
			1: '0377a6fe114e291a8d8e991627c38001c8305b23b9e98b1c7b1893f5cd0dda6cad'
		});
		nock(mintUrl).get('/keys').reply(200, {
			1: '0377a6fe114e291a8d8e991627c38001c8305b23b9e98b1c7b1893f5cd0dda6cad'
		});
		const wallet = new CashuWallet(mint);

		const { isPaid, preimage, change, newKeys } = await wallet.payLnInvoice(invoice, proofs);

		expect(isPaid).toEqual(true);
		expect(preimage).toEqual('');
		expect(change).toHaveLength(1);
		expect(newKeys).toStrictEqual({
			1: '0377a6fe114e291a8d8e991627c38001c8305b23b9e98b1c7b1893f5cd0dda6cad'
		});
	});
});

describe('requestTokens', () => {
	test('test requestTokens', async () => {
		nock(mintUrl)
			.post('/mint?hash=')
			.reply(200, {
				promises: [
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const { proofs } = await wallet.requestTokens(1, '');

		expect(proofs).toHaveLength(1);
		expect(proofs[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(proofs[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(proofs[0].secret)).toBe(true);
	});
	test('test requestTokens bad resonse', async () => {
		nock(mintUrl).post('/mint?hash=').reply(200, {});
		const wallet = new CashuWallet(mint);

		const result = await wallet.requestTokens(1, '').catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
});

describe('send', () => {
	const proofs = [
		{
			id: '0NI3TUAs1Sfy',
			amount: 1,
			secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
		}
	];
	test('test send base case', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: '0NI3TUAs1Sfy',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const result = await wallet.send(1, proofs);

		expect(result.returnChange).toHaveLength(0);
		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: '0NI3TUAs1Sfy' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.send[0].secret)).toBe(true);
	});
	test('test send over paying. Should return change', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const result = await wallet.send(1, [
			{
				id: '0NI3TUAs1Sfy',
				amount: 2,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		]);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.send[0].secret)).toBe(true);
		expect(result.returnChange).toHaveLength(1);
		expect(result.returnChange[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(result.returnChange[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.returnChange[0].secret)).toBe(true);
	});

	test('test send over paying2', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const overpayProofs = [
			{
				id: 'z32vUtKgNCm1',
				amount: 2,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		];
		const result = await wallet.send(1, overpayProofs);

		expect(result.send).toHaveLength(1);
		expect(result.send[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.send[0].secret)).toBe(true);
		expect(result.returnChange).toHaveLength(1);
		expect(result.returnChange[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(result.returnChange[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.returnChange[0].secret)).toBe(true);
	});
	test('test send preference', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const overpayProofs = [
			{
				id: 'z32vUtKgNCm1',
				amount: 2,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			},
			{
				id: 'z32vUtKgNCm1',
				amount: 2,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		];
		const result = await wallet.send(4, overpayProofs, [{ amount: 1, count: 4 }]);

		expect(result.send).toHaveLength(4);
		expect(result.send[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(result.send[2]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(result.send[3]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.send[0].secret)).toBe(true);
		expect(result.returnChange).toHaveLength(0);
	});

	test('test send preference overpay', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					},
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const overpayProofs = [
			{
				id: 'z32vUtKgNCm1',
				amount: 2,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			},
			{
				id: 'z32vUtKgNCm1',
				amount: 2,
				secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
				C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
			}
		];
		const result = await wallet.send(4, overpayProofs, [{ amount: 1, count: 3 }]);

		expect(result.send).toHaveLength(3);
		expect(result.send[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(result.send[1]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(result.send[2]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
		expect(/[0-9a-f]{64}/.test(result.send[0].C)).toBe(true);
		expect(/[A-Za-z0-9+/]{43}=/.test(result.send[0].secret)).toBe(true);
		expect(result.returnChange).toHaveLength(1);
		expect(result.returnChange[0]).toMatchObject({ amount: 1, id: 'z32vUtKgNCm1' });
	});

	test('test send not enough funds', async () => {
		nock(mintUrl)
			.post('/split')
			.reply(200, {
				promises: [
					{
						id: 'z32vUtKgNCm1',
						amount: 1,
						C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422'
					}
				]
			});
		const wallet = new CashuWallet(mint);

		const result = await wallet.send(2, proofs).catch((e) => e);

		expect(result).toEqual(new Error('Not enough funds available'));
	});
	test('test send bad response', async () => {
		nock(mintUrl).post('/split').reply(200, {});
		const wallet = new CashuWallet(mint);

		const result = await wallet
			.send(1, [
				{
					id: 'z32vUtKgNCm1',
					amount: 2,
					secret: 'H5jmg3pDRkTJQRgl18bW4Tl0uTH48GUiF86ikBBnShM=',
					C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'
				}
			])
			.catch((e) => e);

		expect(result).toEqual(new Error('bad response'));
	});
});
