import { describe, expect, it } from 'vitest';
import { showsImpactMenu } from './impactMenu';

describe('影响面右键菜单', () => {
  it('只在本次变更的工作区文件上显示', () => {
    expect(
      showsImpactMenu({
        scheme: 'file',
        relativePath: 'service/a.go',
        changedPaths: ['service/a.go'],
        openedByRedline: false,
      }),
    ).toBe(true);
    expect(
      showsImpactMenu({
        scheme: 'file',
        relativePath: 'service/other.go',
        changedPaths: ['service/a.go'],
        openedByRedline: true,
      }),
    ).toBe(false);
  });

  it('Redline 打开的虚拟变更文件也显示', () => {
    expect(
      showsImpactMenu({
        scheme: 'reviewer',
        changedPaths: ['service/a.go'],
        openedByRedline: true,
      }),
    ).toBe(true);
  });

  it('无关编辑器不显示', () => {
    expect(
      showsImpactMenu({
        scheme: 'untitled',
        changedPaths: ['service/a.go'],
        openedByRedline: false,
      }),
    ).toBe(false);
  });
});
