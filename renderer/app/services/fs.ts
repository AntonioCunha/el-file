import * as fs from 'fs';

import { ElectronService } from 'ngx-electron';
import { Injectable } from '@angular/core';
import { LogOperation } from '../state/fslog';
import { StatusMessage } from '../state/status';
import { Store } from '@ngxs/store';

const MAX_STACK = 100;

/**
 * Model a file system operation
 */

export abstract class Operation {

  redo?: Operation;
  undo?: Operation;

  private str: string;

  constructor(public original: boolean) { }

  run(fsSvc: FSService): OperationResult {
    // capture what we are about to run & run it
    this.str = this.toStringImpl(fsSvc);
    const result = this.runImpl(fsSvc);
    if (result)
      fsSvc.handleError(result.err);
    else {
      fsSvc.handleSuccess(this.str);
      // a new operation clears the redo stack
      // an operation w/o undo clears the undo stack
      if (this.original) {
        if (!this.undo)
          fsSvc.clearUndoStack();
        fsSvc.clearRedoStack();
      }
      // manage the undo/redo stack
      const copy = Object.assign(Object.create(this), { original: false });
      if (this.undo) {
        this.undo.redo = copy;
        this.undo.undo = null;
        fsSvc.pushUndo(this.undo);
        // NOTE: we might never execute the undo action
        // but we still want to know what it does!
        this.undo.str = this.undo.toStringImpl(fsSvc);
      }
      else if (this.redo) {
        this.redo.redo = null;
        this.redo.undo = copy;
        fsSvc.pushRedo(this.redo);
      }
    }
    return result;
  }

  abstract runImpl(fsSvc: FSService): OperationResult;

  toString(): string {
    return this.str;
  }

  abstract toStringImpl(fsSvc: FSService): string;

}

export interface OperationResult {
  err: string;
  partial?: any[];
}

/**
 * File system service
 */

@Injectable()
export class FSService {

  fs: any;
  path: any;
  touch: any;
  trash: any;

  private redoStack: Operation[] = [];
  private undoStack: Operation[] = [];

  /** ctor */
  constructor(private electron: ElectronService,
              private store: Store) {
    this.fs = this.electron.remote.require('fs');
    this.path = this.electron.remote.require('path');
    this.touch = this.electron.remote.require('touch');
    this.trash = this.electron.remote.require('trash');
  }

  /** Can we redo? */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Can we undo? */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Clear the entire redo stack */
  clearRedoStack(): void {
    this.redoStack = [];
  }

  /** Clear the entire undo stack */
  clearUndoStack(): void {
    this.undoStack = [];
  }

  /** Handle an operation error */
  handleError(err: string): void {
    this.store.dispatch(new StatusMessage({ msgLevel: 'warn', msgText: err }));
  }

  /** Handle an operation success */
  handleSuccess(msg: string): void {
    this.store.dispatch(new StatusMessage({ msgLevel: 'info', msgText: msg }));
  }

  /** Perform lstat */
  lstat(path: string): fs.Stats {
    return this.fs.lstatSync(path);
  }

  /** Perform lstat */
  lstats(paths: string[]): fs.Stats[] {
    return paths.reduce((acc, path) => {
      acc.push(this.fs.lstatSync(path));
      return acc;
    }, [] as fs.Stats[]);
  }

  /** Peek at the topmost redo action */
  peekRedo(): Operation {
    return this.canRedo()? this.redoStack[this.redoStack.length - 1] : null;
  }

  /** Peek at the entire redo stack */
  peekRedoStack(): Operation[] {
    return this.redoStack.slice(0);
  }

  /** Peek at the topmost undo action */
  peekUndo(): Operation {
    return this.canUndo()? this.undoStack[this.undoStack.length - 1] : null;
  }

  /** Peek at the entire undo stack */
  peekUndoStack(): Operation[] {
    return this.undoStack.slice(0);
  }

  /** Push an operation onto the redo stack */
  pushRedo(op: Operation): void {
    if (this.redoStack.length > MAX_STACK)
      this.redoStack.splice(0, 1);
    this.redoStack.push(op);
  }

  /** Push an operation onto the undo stack */
  pushUndo(op: Operation): void {
    if (this.undoStack.length > MAX_STACK)
      this.undoStack.splice(0, 1);
    this.undoStack.push(op);
  }

  /** Perform redo operation */
  redo(): void {
    if (this.canRedo()) {
      const op = this.redoStack.splice(-1, 1)[0];
      this.run(op);
    }
  }

  /** Execute operation */
  run(...ops: Operation[]): void {
    ops.forEach(op => {
      if (op) {
        const err = op.run(this);
        if (!err)
          this.store.dispatch(new LogOperation({ op }));
      }
    });
  }

  /** Perform undo operation */
  undo(): void {
    if (this.canUndo()) {
      const op = this.undoStack.splice(-1, 1)[0];
      this.run(op);
    }
  }

  // operations

  chmod(path: string,
        mode: number): OperationResult {
    try {
      this.fs.chmodSync(path, mode);
      return null;
    }
    catch (err) {
      return { err: err.message };
    }
  }

  newDir(path: string): OperationResult {
    try {
      this.fs.accessSync(path);
      return { err: `${path} already exists` };
    }
    catch (e1) {
      try {
        this.fs.mkdirSync(path);
        return null;
      }
      catch (e2) {
        return { err: `${path} permission denied` };
      }
    }
  }

  newFile(path: string): OperationResult {
    try {
      this.fs.accessSync(path);
      return { err: `${path} already exists` };
    }
    catch (e1) {
      try {
        this.touch.sync(path, { force: true });
        return null;
      }
      catch (e2) {
        return { err: `${path} permission denied` };
      }
    }
  }

  rename(from: string,
         to: string): OperationResult {
    try {
      this.fs.accessSync(to);
      return { err: `${to} already exists` };
    }
    catch (err) {
      this.fs.renameSync(from, to);
      return null;
    }
  }

  touchFiles(paths: string[],
             times: Date[]): OperationResult {
    const partial = [];
    try {
      for (let ix = 0; ix < paths.length; ix++) {
        const path = paths[ix];
        const time = times[ix];
        this.touch.sync(path, { force: true, nocreate: true, time });
        partial.push(path);
      }
      return null;
    }
    catch (err) {
      return { err: err.message, partial };
    }
  }

  trashFiles(paths: string[]): OperationResult {
    // NOTE: trash has no error semantics
    this.trash(paths).then(() => console.log(`${paths} trashed`));
    return null;
  }

}