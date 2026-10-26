'use client';

import React, { FC, ChangeEventHandler, FormEventHandler, useEffect, useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { EDIT_POOL } from '@/lib/pool/operations';
import { Button, Input, TextArea, toast } from '@/components/ui';
import { Modal } from '@/components/common';
import { CategoryCheckboxes } from '@/components/dashboard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPool = any;

const STEP_COUNT = 2;

interface EditPoolModalProps {
  pool: AnyPool;
  isOpen: boolean;
  onClose: () => void;
}

const EditPoolModal: FC<EditPoolModalProps> = ({ pool, isOpen, onClose }) => {
  const [step, setStep] = useState(0);

  // Step 1 — Info
  const [nameValue, setNameValue] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [errors, setErrors] = useState({ name: '', description: '' });

  // Step 2 — Categories
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && pool) {
      setStep(0);
      setNameValue(pool.name ?? '');
      setDescriptionValue(pool.description ?? '');
      setSelectedTags(pool.tags ?? []);
      setErrors({ name: '', description: '' });
    }
  }, [isOpen, pool]);

  const [editPool, { loading }] = useMutation(EDIT_POOL);

  // ── Step validation & navigation ──────────────────────────────────────────
  const validateStep0 = () => {
    const nameValid = nameValue.trim().length > 2;
    const descValid = descriptionValue.trim().length > 2;
    setErrors({ name: nameValid ? '' : 'Enter pool name', description: descValid ? '' : 'Enter description' });
    return nameValid && descValid;
  };

  const handleNext = () => {
    if (step === 0 && !validateStep0()) return;
    setStep(s => s + 1);
  };

  const handleBack = () => setStep(s => s - 1);

  const handleSubmit = async () => {
    try {
      const result = await editPool({
        variables: {
          input: {
            id: pool.id,
            updateData: {
              name: nameValue,
              description: descriptionValue,
              tags: selectedTags,
            },
          },
        },
      });

      if (result.error) throw result.error;

      onClose();
      toast('Pool successfully updated!');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update pool. Please try again.';
      toast(message, 'error');
    }
  };

  const nameChangeHandler: ChangeEventHandler<HTMLInputElement> = e => {
    if (e.target.value.trim().length > 2) setErrors(prev => ({ ...prev, name: '' }));
    setNameValue(e.target.value);
  };

  const descriptionChangeHandler: ChangeEventHandler<HTMLTextAreaElement> = e => {
    if (e.target.value.trim().length > 2) setErrors(prev => ({ ...prev, description: '' }));
    setDescriptionValue(e.target.value);
  };

  const step0NextHandler: FormEventHandler<HTMLFormElement> = evt => {
    evt.preventDefault();
    handleNext();
  };

  return (
    <Modal isOpened={isOpen} closeModal={onClose}>
      {/* Header */}
      <div className={'pr-14 pb-4.5 pl-4 border-b-1 border-stroke-primary mb-6'}>
        <div className={'text-base font-medium'}>Update pool</div>
        <div className={'text-xs text-text-secondary mt-0.5'}>Step {step + 1} of {STEP_COUNT}</div>
      </div>

      {/* Step 0 — Info */}
      {step === 0 && (
        <form onSubmit={step0NextHandler}>
          <div className={'px-4 mb-6'}>
            <div className={'text-sm font-medium mb-3'}>
              Pool name<span className={'text-red-bright'}>*</span>
            </div>
            <Input
              placeholder={'For example, «Growth Pool Series A»'}
              size={'sm'}
              colorScheme={'light'}
              errorMessage={errors.name}
              type={'text'}
              name={'poolName'}
              value={nameValue}
              onChange={nameChangeHandler}
            />
          </div>
          <div className={'px-4 mb-6'}>
            <div className={'text-sm font-medium mb-3'}>
              Description<span className={'text-red-bright'}>*</span>
            </div>
            <TextArea
              className={'h-[110px]'}
              maxLength={250}
              errorMessage={errors.description}
              placeholder={'Write a short description for this pool'}
              name={'poolDescription'}
              value={descriptionValue}
              onChange={descriptionChangeHandler}
            />
          </div>
          <div className={'px-4 flex justify-end'}>
            <Button visualType={'quaternary'} type={'submit'}>
              Next
            </Button>
          </div>
        </form>
      )}

      {/* Step 1 — Categories */}
      {step === 1 && (
        <div>
          <div className={'px-4 mb-6'}>
            <CategoryCheckboxes selected={selectedTags} onChange={setSelectedTags} title='Pool categories' />
          </div>
          <div className={'px-4 flex justify-between'}>
            <Button visualType={'quinary'} type={'button'} onClick={handleBack}>
              Back
            </Button>
            <Button visualType={'quaternary'} type={'button'} onClick={handleSubmit} disabled={loading}>
              {loading ? 'Saving…' : 'Apply'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default EditPoolModal;
