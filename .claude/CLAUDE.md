## Overview

This is a project aiming at cloning a essential version of the Minecraft game. The dev plan is in ./.claude/dev_plan.md.

## General Rule

- Follow the dev plan exactly but step by step. You will be instructed to execute a single phase or step at a time
- Even though you will execute only one step at a time, you will read the entire plan to understand overall the plan, and how current step sits within this plan
- At the end of each step implementation, you will be asked to create a `phase_xx_implementation_doc.md` in ./.claude dir, to document you implementation of this phase. Do **NOT** do so on your own, only document phase when you are **explicitly** asked
- When you are implementing a phase, you may reference the previous phase documentations to understand the current code base
- Have the habbit of running linter check after major code write and changes