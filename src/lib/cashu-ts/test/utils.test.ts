import { AmountPreference } from '../src/model/types/index.js';
import * as utils from '../src/utils.js';

describe('test split amounts ', () => {
	test('testing amount 2561', async () => {
		const chunks = utils.splitAmount(2561);
		expect(chunks).toStrictEqual([1, 512, 2048]);
	});
	test('testing amount 0', async () => {
		const chunks = utils.splitAmount(0);
		expect(chunks).toStrictEqual([]);
	});
});

describe('test split custom amounts ', () => {
	const fiveToOne: AmountPreference = { amount: 1, count: 5 };
	test('testing amount 5', async () => {
		const chunks = utils.splitAmount(5, [fiveToOne]);
		expect(chunks).toStrictEqual([1, 1, 1, 1, 1]);
	});
	const tenToOneAndTwo: Array<AmountPreference> = [
		{ amount: 1, count: 2 },
		{ amount: 2, count: 4 }
	];
	test('testing amount 10', async () => {
		const chunks = utils.splitAmount(10, tenToOneAndTwo);
		expect(chunks).toStrictEqual([1, 1, 2, 2, 2, 2]);
	});
	const fiveTwelve: Array<AmountPreference> = [{ amount: 512, count: 2 }];
	test('testing amount 516', async () => {
		const chunks = utils.splitAmount(518, fiveTwelve);
		expect(chunks).toStrictEqual([512, 2, 4]);
	});
	const illegal: Array<AmountPreference> = [{ amount: 3, count: 2 }];
	test('testing non pow2', async () => {
		expect(() => utils.splitAmount(6, illegal)).toThrowError();
	});
	const empty: Array<AmountPreference> = [];
	test('testing empty', async () => {
		const chunks = utils.splitAmount(5, empty);
		expect(chunks).toStrictEqual([1, 4]);
	});
});

describe('test decode token', () => {
	test('testing v1 Token', () => {
		const token =
			'W3siaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjIsInNlY3JldCI6Ild6ZC9vNUVHdmVKb3hTQVlGcjZ1U3lnUmFWSUFrOFc4MXNLTlRxdVd4UjQ9IiwiQyI6IjAzNWNiZmQwOTNiOWZlMWRjNjU2MGEwNDM3YzQyNDQxZjA0ZDIyYzk4MDY2NGMyNGExMGZlZGFiNTlmZWY0YmZjOSJ9LHsiaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjQsInNlY3JldCI6InU0N2lWUkhneUNuUFhCNWxOdFpGaTBOeHpPZ1lyRk1WODV2aFpyRThIbWM9IiwiQyI6IjAyNThiYmZkZWJmZGQzYjk0OTljZDk1YzFkMWZiYTVjZTQ1MWFjOGNlZTE0NzM1Yzk2MGFiMDc1ZmI2ZTQ4ZjBkYyJ9LHsiaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjY0LCJzZWNyZXQiOiJ1YTFaT0hjeVB3T0M0UUxPaWthQVV1MThJM2pEUDJCSVNYREFGcW91N1VNPSIsIkMiOiIwMjU2MWNhNjcyNTdlNzdhNjNjN2U3NWQ4MGVkYTI3ZDlhMmEyYzUxZTA0NGM4ZjhmODVlNzc0OTZlMGRlM2U2NWIifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxLCJzZWNyZXQiOiJ5ZTlNRCtaQ25VUHlHOTBscmYyZ2tudnA3N2I4V05wNUxRT2ZtcERjRGNFPSIsIkMiOiIwM2UwN2M1NjExNzcwMmNmODg3MDFlYjAyOTM2YjA5MDNhZmEyMTQwZDcwNTY1N2ZkODVkM2YxZWI5MzRiYTBjYzMifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoyLCJzZWNyZXQiOiJIUHpzRmZPUDFWRU1BMW8vTnFHVXFhRXdaV2RiN3VERzM4T1grLzlZTURzPSIsIkMiOiIwMmQ3ZDE1YTBhZmIyNThjMjlhZDdmOWY4N2ZmMzIxZWRmNTgyOTM0ZWI0NWExNTE2MjhiNTJjMDExZjQ2MWZkOGEifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxLCJzZWNyZXQiOiJnMVR1YXdha1RVQkJBTW9tZGpDVHkrRENNTnBaUmd3dWluNXB5V2xoTVVNPSIsIkMiOiIwMzU4Y2IxMGE5NWEzY2E1YmE5MTc5MTllMWNhODA1NjZmMTg5NTI4Njk1MTJjYWFjMDlmYmQ5MGYxN2QyZTZlYmEifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoyLCJzZWNyZXQiOiJRMTFyamNXWk55Q2dkRmxqRThaNkdwNFhDYllKcndzRGhncXVQOTU1VWU0PSIsIkMiOiIwMjAxNjBmODIwNGU4MGIxNDg4NmFlMzZjMzRiMjI3ODllMzMxZmM5MjVhNGMwOGE3ZWYxZDZjYzMyYTIwNjZjZWUifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50Ijo4LCJzZWNyZXQiOiI1MVZrUXFYT2kwM0k2a0pzM0tlSEI0OVVCQTFSRktrWnMyMFljZEtOSW1JPSIsIkMiOiIwMjZiYWU2YTgzOWE3OTdjNmU5NGZlNGM5MWZlNTIwOGU4MDE3MTg2Y2NkMDk0ZmI4ZTNkZjYyNjAyZWJmMjczMjUifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxNiwic2VjcmV0IjoiVk4ySlMwUENKdGQ3MjJUTXUxdGFxNUZSMXg0dDlXM28xNndWRGVweXBxYz0iLCJDIjoiMDIxMmM4ZGE5NWE4NDEyYjgyMDE4MTgxNzQxZWY1YWQ0ZjYzMTU1NjBhMWFmODM5ZjMxOTU4NTcwZTVlYzI2ZDQyIn1d';

		const result = utils.getDecodedToken(token);
		expect(result.token[0].proofs.reduce((c, p) => c + p.amount, 0)).toEqual(100);
		expect(result.token[0].mint).toStrictEqual('');
	});
	test('test corrupt v1 token', () => {
		const token =
			'W3siaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjIsInNlY3JldCI6Ild6ZC9vNUVHdmVKb3hTQVlGcjZ1U3lnUmFWSUFrOFc4MXNLTlRxdVd4UjQ9IiwiQyI6IjAzNWNiZmQwOTNiOWZlMWRjNjU2MGEwNDM3YzQyNDQxZjA0ZDIyYzk4MDY2NGMyNGExMGZlZGFiNTlmZWY0YmZjOSJ9LHsiaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjQsInNlY3JldCI6InU0N2lWUkhneUNuUFhCNWxOdFpGaTBOIkMiOiIwMmQ3ZDE1YTBhZmIyNThjMjlhZDdmOWY4N2ZmMzIxZWRmNTgyOTM0ZWI0NWExNTE2MjhiNTJjMDExZjQ2MWZkOGEifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxLCJzZWNyZXQiOiJnMVR1YXdha1RVQkJBTW9tZGpDVHkrRENNTnBaUmd3dWluNXB5V2xoTVVNPSIsIkMiOiIwMzU4Y2IxMGE5NWEzY2E1YmE5MTc5MTllMWNhODA1NjZmMTg5NTI4Njk1MTJjYWFjMDlmYmQ5MGYxN2QyZTZlYmEifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoyLCJzZWNyZXQiOiJRMTFyamNXWk55Q2dkRmxqRThaNkdwNFhDYllKcndzRGhncXVQOTU1VWU0PSIsIkMiOiIwMjAxNjBmODIwNGU4MGIxNDg4NmFlMzZjMzRiMjI3ODllMzMxZmM5MjVhNGMwOGE3ZWYxZDZjYzMyYTIwNjZjZWUifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50Ijo4LCJzZWNyZXQiOiI1MVZrUXFYT2kwM0k2a0pzM0tlSEI0OVVCQTFSRktrWnMyMFljZEtOSW1JPSIsIkMiOiIwMjZiYWU2YTgzOWE3OTdjNmU5NGZlNGM5MWZlNTIwOGU4MDE3MTg2Y2NkMDk0ZmI4ZTNkZjYyNjAyZWJmMjczMjUifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxNiwic2VjcmV0IjoiVk4ySlMwUENKdGQ3MjJUTXUxdGFxNUZSMXg0dDlXM28xNndWRGVweXBxYz0iLCJDIjoiMDIxMmM4ZGE5NWE4NDEyYjgyMDE4MTgxNzQxZWY1YWQ0ZjYzMTU1NjBhMWFmODM5ZjMxOTU4NTcwZTVlYzI2ZDQyIn1d';
		expect(() => utils.getDecodedToken(token)).toThrowError();
	});
	test('testing v2 Token', async () => {
		const token =
			'eyJwcm9vZnMiOlt7ImlkIjoiSTJ5TitpUllma3pUIiwiYW1vdW50IjoxLCJzZWNyZXQiOiI5N3pmbW1hR2Y1azhNZzBnYWpwbmJtcGVydlR0RWVFOHd3S3JpN3JXcFVzPSIsIkMiOiIwMjE5NTA4MWU2MjJmOThiZmMxOWEwNWViZTIzNDFkOTU1YzBkMTI1ODhjNTk0OGM4NThkMDdhZGVjMDA3YmMxZTQifV0sIm1pbnRzIjpbeyJ1cmwiOiJodHRwczovLzgzMzMuc3BhY2U6MzMzOCIsImlkcyI6WyJMM3p4eFJCL0k4dUUiLCJJMnlOK2lSWWZrelQiXX1dfQ';

		const result = utils.getDecodedToken(token);
		expect(result).toStrictEqual({
			token: [
				{
					proofs: [
						{
							id: 'I2yN+iRYfkzT',
							amount: 1,
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs=',
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4'
						}
					],
					mint: 'https://8333.space:3338'
				}
			]
		});
	});
	test('testing v2 Token 2', () => {
		const token =
			'eyJwcm9vZnMiOlt7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxLCJzZWNyZXQiOiJreHFYWXBiQ1ZvSXV4NGxtV0lEWHgzb00yLzdLVnNocWpKSUlleHRxTWFVPSIsIkMiOiIwMmE0MjE0MGQxYmJkNTljYTRjNWJhOWViNzNkMDIwZjMxZjY4ZjRlMzA3OGZkM2FmMWVlNjRlYmVjZTUyYjZlZGEifV0sIm1pbnRzIjpbeyJ1cmwiOiJodHRwczovL2xlZ2VuZC5sbmJpdHMuY29tL2Nhc2h1L2FwaS92MS80Z3I5WGNtejNYRWtVTndpQmlRR29DIiwiaWRzIjpbIjBOSTNUVUFzMVNmeSJdfV19';

		const result = utils.getDecodedToken(token);
		expect(result).toStrictEqual({
			token: [
				{
					proofs: [
						{
							id: '0NI3TUAs1Sfy',
							amount: 1,
							secret: 'kxqXYpbCVoIux4lmWIDXx3oM2/7KVshqjJIIextqMaU=',
							C: '02a42140d1bbd59ca4c5ba9eb73d020f31f68f4e3078fd3af1ee64ebece52b6eda'
						}
					],
					mint: 'https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC'
				}
			]
		});
	});
	test('test corrupt v2 token', () => {
		const token =
			'W3siaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjIsInNlY3JldCI6Ild6ZC9vNUVHdmVKb3hTQVlGcjZ1U3lnUmFWSUFrOFc4MXNLTlRxdVd4UjQ9IiwiQyI6IjAzNWNiZmQwOTNiOWZlMWRjNjU2MGEwNDM3YzQyNDQxZjA0ZDIyYzk4MDY2NGMyNGExMGZlZGFiNTlmZWY0YmZjOSJ9LHsiaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjQsInNlY3JldCI6InU0N2lWUkhneUNuUFhCNWxOdFpGaTBOIkMiOiIwMmQ3ZDE1YTBhZmIyNThjMjlhZDdmOWY4N2ZmMzIxZWRmNTgyOTM0ZWI0NWExNTE2MjhiNTJjMDExZjQ2MWZkOGEifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxLCJzZWNyZXQiOiJnMVR1YXdha1RVQkJBTW9tZGpDkMiOiIwMjZiYWU2YTgzOWE3OTdjNmU5NGZlNGM5MWZlNTIwOGU4MDE3MTg2Y2NkMDk0ZmI4ZTNkZjYyNjAyZWJmMjczMjUifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxNiwic2VjcmV0IjoiVk4ySlMwUENKdGQ3MjJUTXUxdGFxNUZSMXg0dDlXM28xNndWRGVweXBxYz0iLCJDIjoiMDIxMmM4ZGE5NWE4NDEyYjgyMDE4MTgxNzQxZWY1YWQ0ZjYzMTU1NjBhMWFmODM5ZjMxOTU4NTcwZTVlYzI2ZDQyIn1d';

		expect(() => utils.getDecodedToken(token)).toThrowError();
	});
});

describe('test encode token', () => {
	test('testing v3 Token', async () => {
		const token =
			'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJpZCI6IkkyeU4raVJZZmt6VCIsImFtb3VudCI6MSwic2VjcmV0IjoiOTd6Zm1tYUdmNWs4TWcwZ2FqcG5ibXBlcnZUdEVlRTh3d0tyaTdyV3BVcz0iLCJDIjoiMDIxOTUwODFlNjIyZjk4YmZjMTlhMDVlYmUyMzQxZDk1NWMwZDEyNTg4YzU5NDhjODU4ZDA3YWRlYzAwN2JjMWU0In1dfV19';

		const obj = {
			proofs: [
				{
					id: 'I2yN+iRYfkzT',
					amount: 1,
					secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs=',
					C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4'
				}
			],
			mints: [{ url: 'https://8333.space:3338', ids: ['L3zxxRB/I8uE', 'I2yN+iRYfkzT'] }]
		};

		const result = utils.getEncodedToken({
			token: [{ mint: obj.mints[0].url, proofs: obj.proofs }]
		});
		expect(result).toEqual(token);
	});
});

describe('test decode token', () => {
	test('testing v3 Token', async () => {
		const obj = {
			token: [
				{
					proofs: [
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						}
					],
					mint: 'https://8333.space:3338'
				}
			]
		};
		const uriPrefixes = ['web+cashu://', 'cashu://', 'cashu:'];
		uriPrefixes.forEach((prefix) => {
			const token =
				prefix +
				'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJpZCI6IkkyeU4raVJZZmt6VCIsImFtb3VudCI6MSwic2VjcmV0IjoiOTd6Zm1tYUdmNWs4TWcwZ2FqcG5ibXBlcnZUdEVlRTh3d0tyaTdyV3BVcz0iLCJDIjoiMDIxOTUwODFlNjIyZjk4YmZjMTlhMDVlYmUyMzQxZDk1NWMwZDEyNTg4YzU5NDhjODU4ZDA3YWRlYzAwN2JjMWU0In1dfV19';

			const result = utils.getDecodedToken(token);
			expect(result).toStrictEqual(obj);
		});
	});
	test('testing v3 Token no prefix', async () => {
		const obj = {
			token: [
				{
					proofs: [
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						}
					],
					mint: 'https://8333.space:3338'
				}
			]
		};

		const token =
			'eyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJpZCI6IkkyeU4raVJZZmt6VCIsImFtb3VudCI6MSwic2VjcmV0IjoiOTd6Zm1tYUdmNWs4TWcwZ2FqcG5ibXBlcnZUdEVlRTh3d0tyaTdyV3BVcz0iLCJDIjoiMDIxOTUwODFlNjIyZjk4YmZjMTlhMDVlYmUyMzQxZDk1NWMwZDEyNTg4YzU5NDhjODU4ZDA3YWRlYzAwN2JjMWU0In1dfV19';
		const result = utils.getDecodedToken(token);
		expect(result).toStrictEqual(obj);
	});
});

describe('test cleanToken', () => {
	test('testing cleanToken no mint', async () => {
		const obj = {
			token: [
				{
					proofs: [
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						}
					],
					mint: ''
				}
			]
		};
		const result = utils.cleanToken(obj);
		expect(result).toStrictEqual({ token: [], memo: undefined });
	});
	test('testing cleanToken no proofs', async () => {
		const obj = {
			token: [
				{
					proofs: [],
					mint: 'test'
				}
			]
		};
		const result = utils.cleanToken(obj);
		expect(result).toStrictEqual({ token: [], memo: undefined });
	});
	test('testing cleanToken 2 tokenEntries from same mint', async () => {
		const obj = {
			token: [
				{
					proofs: [
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						}
					],
					mint: 'test'
				},
				{
					proofs: [
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						}
					],
					mint: 'test'
				}
			]
		};
		const result = utils.cleanToken(obj);

		expect(result.token).toHaveLength(1);
		expect(result).toStrictEqual({
			token: [
				{
					mint: 'test',
					proofs: obj.token.flatMap((x) => x.proofs)
				}
			],
			memo: undefined
		});
	});
	test('testing cleanToken proofs sorted', async () => {
		const obj = {
			token: [
				{
					proofs: [
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						},
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'test',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						},
						{
							C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
							amount: 1,
							id: 'I2yN+iRYfkzT',
							secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs='
						}
					],
					mint: 'test'
				}
			]
		};
		const result = utils.cleanToken(obj);
		expect(result.token[0].proofs).toHaveLength(3);
		expect(result.token[0].proofs[0].id).toBe('I2yN+iRYfkzT');
		expect(result.token[0].proofs[1].id).toBe('I2yN+iRYfkzT');
		expect(result.token[0].proofs[2].id).toBe('test');
	});
	test('testing joining urls', () => {
		const mint_url = 'https://8333.space:3338';
		const info_url = utils.joinUrls(mint_url, 'info');

		expect(info_url).toBe('https://8333.space:3338/info');

		const mint_url_trailing_slash = 'https://8333.space:3338/';
		const mint_info_url = utils.joinUrls(mint_url_trailing_slash, 'info');
		expect(mint_info_url).toBe('https://8333.space:3338/info');
	});
});
