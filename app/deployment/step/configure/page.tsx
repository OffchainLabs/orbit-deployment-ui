'use client';

import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { z } from 'zod';

import { useDeploymentPageContext } from '@/components/DeploymentPageContext';
import { DocsPanel } from '@/components/DocsPanel';
import { GasTokenInput } from '@/components/GasTokenInput';
import { ScrollWrapper } from '@/components/ScrollWrapper';
import { StepTitle } from '@/components/StepTitle';
import { TextInputWithInfoLink } from '@/components/TextInputWithInfoLink';
import { WalletAddressManager } from '@/components/WalletAddressManager';
import { useStep } from '@/hooks/useStep';
import { deployRollup } from '@/utils/deployRollup';
import { AddressSchema } from '@/utils/schemas';
import { compareWallets } from '@/utils/wallets';
import { zodResolver } from '@hookform/resolvers/zod';
import { showSigningErrorToast } from '@/utils/errors';

const WalletAddressListSchema = z.array(AddressSchema).superRefine((data, ctx) => {
  const seen = new Set();

  data.forEach((address, index) => {
    if (seen.has(address)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate addresses are not allowed',
        path: [index],
      });
    } else {
      seen.add(address);
    }
  });
});

const rollupConfigSchema = z.object({
  chainId: z.number().gt(0),
  chainName: z.string().nonempty(),
  confirmPeriodBlocks: z.number().gt(0),
  stakeToken: z.string(),
  baseStake: z.number().gt(0),
  owner: AddressSchema,
  nativeToken: AddressSchema,
  validators: WalletAddressListSchema,
  batch_posters: WalletAddressListSchema,
});

export type RollupConfigFormValues = z.infer<typeof rollupConfigSchema>;

export default function RollupConfigPage() {
  const [
    { rollupConfig, chainType, validators: savedWallets, batch_posters: savedBatchPosters },
    dispatch,
  ] = useDeploymentPageContext();
  const { nextStep, rollupConfigFormRef } = useStep();
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  // refines the schema to check if token decimals is 18
  // done here because zod schema must be synchronous
  const refinedRollupConfigSchema = rollupConfigSchema.refine(
    (data) => {
      return tokenDecimals && tokenDecimals <= 36;
    },
    {
      message: 'Token decimals must be less than or equal 36.',
      path: ['nativeToken'],
    },
  );

  const methods = useForm<z.infer<typeof rollupConfigSchema>>({
    defaultValues: {
      ...rollupConfig,
      validators: savedWallets?.map((wallet) => wallet.address) || [],
      batch_posters: savedBatchPosters?.map((wallet) => wallet.address) || [],
    },
    mode: 'onBlur',
    resolver: zodResolver(refinedRollupConfigSchema),
  });

  const {
    handleSubmit,
    register,
    formState: { errors },
  } = methods;

  const onSubmit = async (updatedRollupConfig: RollupConfigFormValues) => {
    try {
      dispatch({
        type: 'set_rollup_config',
        payload: { ...rollupConfig, ...updatedRollupConfig, stakeToken: rollupConfig.stakeToken },
      });

      // Compare and update validators
      const updatedValidators = compareWallets(savedWallets || [], updatedRollupConfig.validators);
      dispatch({
        type: 'set_validators',
        payload: updatedValidators,
      });

      // Compare and update batch posters
      const updatedBatchPosters = compareWallets(
        savedBatchPosters || [],
        updatedRollupConfig.batch_posters,
      );
      dispatch({
        type: 'set_batch_posters',
        payload: updatedBatchPosters,
      });

      dispatch({ type: 'set_is_loading', payload: true });
      if (!walletClient || !address) return;
      const rollupArgs = {
        rollupConfig: {
          ...rollupConfig,
          ...updatedRollupConfig,
          stakeToken: rollupConfig.stakeToken,
        },
        validators: updatedValidators,
        batchPosters: updatedBatchPosters,
        chainType,
        account: address,
        publicClient,
        walletClient,
      };
      const rollupContracts = await deployRollup(rollupArgs);
      dispatch({ type: 'set_rollup_contracts', payload: rollupContracts });
      nextStep();
    } catch (e) {
      console.error(e);
      showSigningErrorToast(e);
    } finally {
      dispatch({ type: 'set_is_loading', payload: false });
    }
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(onSubmit)} ref={rollupConfigFormRef}>
        <div className="border-px flex flex-wrap rounded-md border border-grey">
          <div className="hide-scrollbar flex w-full flex-col gap-2 overflow-y-scroll p-8 md:h-[80vh] md:w-1/2">
            <StepTitle className="mb-4">Review & Deploy</StepTitle>
            <TextInputWithInfoLink
              label="Chain ID"
              type="number"
              placeholder="12345678"
              defaultValue={rollupConfig?.chainId || ''}
              register={() =>
                register('chainId', {
                  setValueAs: (value) => Number(value),
                })
              }
              error={errors.chainId?.message}
              anchor={'chain-id'}
            />
            <TextInputWithInfoLink
              label="Chain Name"
              defaultValue={rollupConfig?.chainName || ''}
              error={errors.chainName?.message}
              register={() => register('chainName')}
              anchor={'chain-name'}
            />

            <TextInputWithInfoLink
              label="Challenge Period Blocks"
              type="number"
              error={errors.confirmPeriodBlocks?.message}
              defaultValue={rollupConfig?.confirmPeriodBlocks || ''}
              register={() =>
                register('confirmPeriodBlocks', {
                  setValueAs: (value) => Number(value),
                })
              }
              anchor={'challenge-period-blocks'}
            />

            <TextInputWithInfoLink
              label="Stake Token"
              defaultValue={'ETH'}
              disabled
              anchor={'stake-token'}
            />

            <TextInputWithInfoLink
              label="Base Stake (in Ether)"
              type="number"
              step="any"
              defaultValue={rollupConfig?.baseStake || 0}
              error={errors.baseStake?.message}
              register={() =>
                register('baseStake', {
                  setValueAs: (value) => Number(value),
                })
              }
              anchor={'base-stake'}
            />

            <TextInputWithInfoLink
              label="Owner"
              defaultValue={rollupConfig?.owner || ''}
              register={() => register('owner')}
              error={errors.owner?.message}
              anchor={'owner'}
            />
            <GasTokenInput setTokenDecimals={setTokenDecimals} />
            <label className={'cursor-pointer underline'}>
              <ScrollWrapper anchor="validators">
                <span>Validators #</span>
              </ScrollWrapper>
            </label>
            <WalletAddressManager fieldName="validators" label="Validator" />
            <label className={'cursor-pointer underline'}>
              <ScrollWrapper anchor="batch-posters">
                <span>Batch Posters #</span>
              </ScrollWrapper>
            </label>
            <WalletAddressManager fieldName="batch_posters" label="Batch Poster" />
          </div>
          <div className="border-px h-[80vh] w-full  border-t border-grey p-8 md:w-1/2 md:border-l md:border-t-0">
            <DocsPanel />
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
